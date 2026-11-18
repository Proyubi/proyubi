package ai.proyubi.identity.authprovider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

/**
 * Google OAuth 认证提供者
 *
 * <p>职责纯粹：把授权 code 换成 {@link OAuthUserProfile}。不做 DB，不做 Sa-Token。
 * DB 的 find-or-create 由 IdentityService + AccountModel 协作。
 *
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GoogleAuthProvider implements AuthProvider {

    private static final String PROVIDER_TYPE = "google";
    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Value("${google.oauth.client-id:}")
    private String clientId;

    @Value("${google.oauth.client-secret:}")
    private String clientSecret;

    @Value("${google.oauth.redirect-uri:}")
    private String redirectUri;

    @Override
    public String getType() {
        return PROVIDER_TYPE;
    }

    @Override
    public boolean isOAuth() {
        return true;
    }

    @Override
    public boolean isConfigured() {
        return clientId != null && !clientId.isBlank()
            && clientSecret != null && !clientSecret.isBlank()
            && redirectUri != null && !redirectUri.isBlank();
    }

    @Override
    public String buildAuthUrl(String state) {
        return buildAuthUrl(state, null);
    }

    @Override
    public String buildAuthUrl(String state, String redirectUriOverride) {
        if (!isConfigured()) {
            throw new OAuthExchangeException("not_configured",
                "Google OAuth is not configured (GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REDIRECT_URI)");
        }
        String effectiveRedirect = effectiveRedirectUri(redirectUriOverride);
        return AUTH_URL
            + "?client_id=" + urlEncode(clientId)
            + "&redirect_uri=" + urlEncode(effectiveRedirect)
            + "&response_type=code"
            + "&scope=" + urlEncode("openid email profile")
            + "&state=" + urlEncode(state)
            + "&access_type=online"
            + "&prompt=select_account";
    }

    @Override
    public OAuthUserProfile exchangeOAuth(String code) {
        return exchangeOAuth(code, null);
    }

    @Override
    public OAuthUserProfile exchangeOAuth(String code, String redirectUriOverride) {
        if (!isConfigured()) {
            throw new OAuthExchangeException("not_configured",
                "Google OAuth is not configured");
        }
        String accessToken = exchangeCodeForAccessToken(code, effectiveRedirectUri(redirectUriOverride));
        JsonNode userinfo = fetchUserinfo(accessToken);

        String sub = textOrNull(userinfo, "sub");
        String email = textOrNull(userinfo, "email");
        Boolean verified = userinfo.has("email_verified") ? userinfo.get("email_verified").asBoolean() : null;
        String name = textOrNull(userinfo, "name");
        String picture = textOrNull(userinfo, "picture");

        if (sub == null || email == null) {
            throw new OAuthExchangeException("userinfo_incomplete",
                "Google userinfo missing sub/email: " + userinfo);
        }
        return new OAuthUserProfile(
            PROVIDER_TYPE,
            sub,
            email,
            verified != null && verified,
            name,
            picture
        );
    }

    /** override 为空时回退到配置的 redirect-uri；二者都为空则交给 Google 报错。 */
    private String effectiveRedirectUri(String override) {
        return (override != null && !override.isBlank()) ? override : redirectUri;
    }

    private String exchangeCodeForAccessToken(String code, String effectiveRedirect) {
        String form = "grant_type=authorization_code"
            + "&code=" + urlEncode(code)
            + "&client_id=" + urlEncode(clientId)
            + "&client_secret=" + urlEncode(clientSecret)
            + "&redirect_uri=" + urlEncode(effectiveRedirect);

        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(TOKEN_URL))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(form))
            .build();

        HttpResponse<String> resp;
        try {
            resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new OAuthExchangeException("token_exchange_failed",
                "Google token exchange network error", e);
        }
        if (resp.statusCode() != 200) {
            log.warn("Google token exchange failed: status={}, body={}", resp.statusCode(), resp.body());
            throw new OAuthExchangeException("token_exchange_failed",
                "Google token exchange returned HTTP " + resp.statusCode());
        }
        JsonNode json;
        try {
            json = objectMapper.readTree(resp.body());
        } catch (IOException e) {
            throw new OAuthExchangeException("token_exchange_failed",
                "Google token response is not valid JSON", e);
        }
        String accessToken = textOrNull(json, "access_token");
        if (accessToken == null || accessToken.isBlank()) {
            throw new OAuthExchangeException("token_exchange_failed",
                "Google token response has no access_token: " + resp.body());
        }
        return accessToken;
    }

    private JsonNode fetchUserinfo(String accessToken) {
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(USERINFO_URL))
            .header("Authorization", "Bearer " + accessToken)
            .header("Accept", "application/json")
            .GET()
            .build();
        HttpResponse<String> resp;
        try {
            resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new OAuthExchangeException("userinfo_failed",
                "Google userinfo network error", e);
        }
        if (resp.statusCode() != 200) {
            log.warn("Google userinfo failed: status={}, body={}", resp.statusCode(), resp.body());
            throw new OAuthExchangeException("userinfo_failed",
                "Google userinfo returned HTTP " + resp.statusCode());
        }
        try {
            return objectMapper.readTree(resp.body());
        } catch (IOException e) {
            throw new OAuthExchangeException("userinfo_failed",
                "Google userinfo response is not valid JSON", e);
        }
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v == null || v.isNull()) ? null : v.asText();
    }

    private static String urlEncode(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }
}
