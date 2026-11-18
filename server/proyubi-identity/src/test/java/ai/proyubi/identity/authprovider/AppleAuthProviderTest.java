package ai.proyubi.identity.authprovider;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link AppleAuthProvider} の JWT 検証契約テスト。
 *
 * <p>この検証がザルだと「誰でも任意のアカウントとしてログインできる」ため、
 * 正常系より<b>拒否されるべきケース</b>を厚めに固定している。
 *
 * <p>ネットワークには出ない：Apple JWKS の代わりに、テストで生成した RSA 公開鍵を
 * provider 内のキャッシュへリフレクションで流し込む（実運用の {@code fetchJwks()} は
 * kid 未命中 or TTL 切れのときだけ走るので、鍵入り + fetchedAt=now なら発火しない）。
 */
class AppleAuthProviderTest {

    private static final String KID = "test-kid";
    private static final String CLIENT_ID = "com.example.app";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AppleAuthProvider provider;
    private KeyPair keyPair;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();

        provider = new AppleAuthProvider(MAPPER);
        setField("clientIdsRaw", CLIENT_ID + ",com.example.app2");
        setField("jwksCache", Map.of(KID, (RSAPublicKey) keyPair.getPublic()));
        setField("jwksFetchedAt", Instant.now());
    }

    @Test
    void verifiesValidTokenAndMapsProfile() {
        String token = signedToken(claims(CLIENT_ID, Instant.now().plusSeconds(300),
            "\"email\":\"taro@example.com\",\"email_verified\":\"true\","), null);

        OAuthUserProfile profile = provider.verifyNativeIdentityToken(token, null);

        assertEquals("apple", profile.providerType());
        assertEquals("001234.abcdef.5678", profile.externalId());
        assertEquals("apple:001234.abcdef.5678", profile.toIdentityIdentifier());
        assertEquals("taro@example.com", profile.email());
        // Apple は email_verified を文字列 "true" で返すことがある
        assertTrue(profile.emailVerified());
        // 氏名は JWT に入らない（初回認可時にクライアント経由でしか来ない）
        assertEquals(null, profile.name());
    }

    /** 中継メール（メールを隠す）でも普通に通ること。4.8 対応の本質なので固定する。 */
    @Test
    void acceptsPrivateRelayEmail() {
        String token = signedToken(claims(CLIENT_ID, Instant.now().plusSeconds(300),
            "\"email\":\"abc123@privaterelay.appleid.com\",\"email_verified\":true,"
                + "\"is_private_email\":true,"), null);

        OAuthUserProfile profile = provider.verifyNativeIdentityToken(token, null);

        assertEquals("abc123@privaterelay.appleid.com", profile.email());
        assertTrue(profile.emailVerified());
    }

    @Test
    void rejectsTokenSignedByAnotherKey() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        PrivateKey attackerKey = gen.generateKeyPair().getPrivate();

        String token = sign(claims(CLIENT_ID, Instant.now().plusSeconds(300), ""), attackerKey);

        assertEquals("token_invalid", reasonOf(token, null));
    }

    @Test
    void rejectsTamperedPayload() {
        String token = signedToken(claims(CLIENT_ID, Instant.now().plusSeconds(300),
            "\"email\":\"taro@example.com\","), null);
        String[] parts = token.split("\\.");
        String forged = b64(claims(CLIENT_ID, Instant.now().plusSeconds(300),
            "\"email\":\"attacker@example.com\",").replace("001234.abcdef.5678", "999999.hacked"));

        assertEquals("token_invalid", reasonOf(parts[0] + "." + forged + "." + parts[2], null));
    }

    @Test
    void rejectsWrongAudience() {
        String token = signedToken(claims("com.someone.else",
            Instant.now().plusSeconds(300), ""), null);

        assertEquals("token_invalid", reasonOf(token, null));
    }

    @Test
    void rejectsWrongIssuer() {
        String payload = "{\"iss\":\"https://evil.example.com\",\"aud\":\"" + CLIENT_ID
            + "\",\"sub\":\"001234.abcdef.5678\",\"exp\":"
            + Instant.now().plusSeconds(300).getEpochSecond() + "}";

        assertEquals("token_invalid", reasonOf(signedToken(payload, null), null));
    }

    @Test
    void rejectsExpiredToken() {
        String token = signedToken(claims(CLIENT_ID, Instant.now().minusSeconds(3600), ""), null);

        assertEquals("token_expired", reasonOf(token, null));
    }

    @Test
    void rejectsNonceMismatch() {
        String token = signedToken(claims(CLIENT_ID, Instant.now().plusSeconds(300),
            "\"nonce\":\"someone-elses-nonce\","), null);

        assertEquals("nonce_mismatch", reasonOf(token, "my-nonce"));
    }

    /** クライアントは raw nonce を送る。Apple のトークンには送った値がそのまま入る。 */
    @Test
    void acceptsMatchingRawNonce() {
        String token = signedToken(claims(CLIENT_ID, Instant.now().plusSeconds(300),
            "\"nonce\":\"my-raw-nonce\","), null);

        OAuthUserProfile profile = provider.verifyNativeIdentityToken(token, "my-raw-nonce");
        assertEquals("001234.abcdef.5678", profile.externalId());
    }

    @Test
    void rejectsMalformedToken() {
        assertEquals("token_invalid", reasonOf("not-a-jwt", null));
        assertEquals("token_invalid", reasonOf("", null));
    }

    /** alg=none による署名バイパスを塞いでいること。 */
    @Test
    void rejectsAlgNone() {
        String header = b64("{\"alg\":\"none\",\"kid\":\"" + KID + "\"}");
        String payload = b64(claims(CLIENT_ID, Instant.now().plusSeconds(300), ""));

        assertEquals("token_invalid", reasonOf(header + "." + payload + ".", null));
    }

    @Test
    void reportsNotConfiguredWhenClientIdsMissing() throws Exception {
        setField("clientIdsRaw", "");

        assertEquals(false, provider.isConfigured());
        assertEquals("not_configured",
            reasonOf(signedToken(claims(CLIENT_ID, Instant.now().plusSeconds(300), ""), null), null));
    }

    // --- helpers ---

    private String reasonOf(String token, String nonce) {
        OAuthExchangeException e = assertThrows(OAuthExchangeException.class,
            () -> provider.verifyNativeIdentityToken(token, nonce));
        return e.getReasonCode();
    }

    /**
     * @param extraJsonFields 追加 claim（末尾カンマ付き / 空文字可）。空のときにカンマを
     *                        足すと JSON が壊れて全ケースが token_invalid になり、
     *                        aud / exp などの検証を通ったつもりで通っていない状態になる。
     */
    private static String claims(String aud, Instant exp, String extraJsonFields) {
        String extra = extraJsonFields.replaceAll(",\\s*$", "");
        return "{\"iss\":\"https://appleid.apple.com\""
            + ",\"aud\":\"" + aud + "\""
            + ",\"sub\":\"001234.abcdef.5678\""
            + ",\"iat\":" + Instant.now().getEpochSecond()
            + ",\"exp\":" + exp.getEpochSecond()
            + (extra.isEmpty() ? "" : "," + extra)
            + "}";
    }

    private String signedToken(String payloadJson, String kidOverride) {
        return sign(payloadJson, keyPair.getPrivate(), kidOverride);
    }

    private String sign(String payloadJson, PrivateKey key) {
        return sign(payloadJson, key, null);
    }

    private static String sign(String payloadJson, PrivateKey key, String kidOverride) {
        String header = b64("{\"alg\":\"RS256\",\"kid\":\""
            + (kidOverride != null ? kidOverride : KID) + "\"}");
        String payload = b64(payloadJson);
        String signingInput = header + "." + payload;
        try {
            Signature signer = Signature.getInstance("SHA256withRSA");
            signer.initSign(key);
            signer.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            return signingInput + "."
                + Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String b64(String s) {
        return Base64.getUrlEncoder().withoutPadding()
            .encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private void setField(String name, Object value) throws Exception {
        Field f = AppleAuthProvider.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(provider, value);
    }
}
