package ai.proyubi.server;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class LegacyBrandEnvironmentPostProcessorTest {
    @Test void legacyPropertiesOverridePackagedDefaults() {
        var env = new StandardEnvironment();
        env.getPropertySources().addLast(new MapPropertySource("defaults", Map.of("proyubi.internal-api.key", "default")));
        env.getPropertySources().addFirst(new MapPropertySource("external", Map.of("pullcord.internal-api.key", "legacy-key")));
        new LegacyBrandEnvironmentPostProcessor().postProcessEnvironment(env, null);
        assertEquals("legacy-key", env.getProperty("proyubi.internal-api.key"));
    }
    @Test void explicitNewNameWinsWithinSameSource() {
        var env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("external", Map.of("pullcord.tenancy.mode", "SINGLE", "proyubi.tenancy.mode", "MULTI")));
        new LegacyBrandEnvironmentPostProcessor().postProcessEnvironment(env, null);
        assertEquals("MULTI", env.getProperty("proyubi.tenancy.mode"));
    }
    @Test void legacyEnvironmentWorksForValuesAndBinding() {
        var env = new StandardEnvironment();
        env.getPropertySources().addFirst(new SystemEnvironmentPropertySource("legacyEnv", Map.of("PULLCORD_TENANCY_MODE", "SINGLE", "PULLCORD_INTERNAL_API_KEY", "legacy")));
        new LegacyBrandEnvironmentPostProcessor().postProcessEnvironment(env, null);
        assertEquals("legacy", env.getProperty("proyubi.internal-api.key"));
        assertEquals("SINGLE", Binder.get(env).bind("proyubi.tenancy.mode", String.class).get());
        assertEquals(ai.proyubi.common.mybatisflex.tenant.TenancyProperties.Mode.SINGLE, Binder.get(env).bind("proyubi.tenancy", ai.proyubi.common.mybatisflex.tenant.TenancyProperties.class).get().getMode());
    }
    @Test void newEnvironmentWinsAndRepeatedProcessingIsSafe() {
        var env = new StandardEnvironment();
        env.getPropertySources().addFirst(new SystemEnvironmentPropertySource("legacyEnv", Map.of("PULLCORD_TENANCY_MODE", "SINGLE", "PROYUBI_TENANCY_MODE", "MULTI")));
        var processor = new LegacyBrandEnvironmentPostProcessor();
        processor.postProcessEnvironment(env, null);
        processor.postProcessEnvironment(env, null);
        assertEquals("MULTI", Binder.get(env).bind("proyubi.tenancy.mode", String.class).get());
    }
    @Test void dotenvUppercaseLegacyAliasRemainsAvailable() {
        var env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("dotenv", Map.of("PULLCORD_TENANCY_MODE", "SINGLE")));
        new LegacyBrandEnvironmentPostProcessor().postProcessEnvironment(env, null);
        assertEquals("SINGLE", env.resolveRequiredPlaceholders("${PROYUBI_TENANCY_MODE:${PULLCORD_TENANCY_MODE:MULTI}}"));
    }
    @Test void compatibilityProcessorIsRegisteredAfterDotenv() {
        var factories = org.springframework.core.io.support.SpringFactoriesLoader.loadFactoryNames(org.springframework.boot.env.EnvironmentPostProcessor.class, getClass().getClassLoader());
        assertTrue(factories.contains(LegacyBrandEnvironmentPostProcessor.class.getName()));
        assertTrue(new LegacyBrandEnvironmentPostProcessor().getOrder() > new DotEnvEnvironmentPostProcessor().getOrder());
    }

}
