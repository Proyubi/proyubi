package ai.proyubi.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.*;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

/** Compatibility aliases for existing deployments; never changes persistent data or original keys. */
public class LegacyBrandEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {
    @Override public int getOrder() { return ConfigDataEnvironmentPostProcessor.ORDER + 2; }

    @Override public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        var sources = new ArrayList<PropertySource<?>>();
        environment.getPropertySources().forEach(sources::add);
        for (PropertySource<?> source : sources) {
            if (!(source instanceof EnumerablePropertySource<?> enumerable) || source.getName().startsWith("proyubi-legacy:")) continue;
            Map<String, Object> aliases = new LinkedHashMap<>();
            for (String key : enumerable.getPropertyNames()) {
                String next = key.startsWith("pullcord.") ? "proyubi." + key.substring(9)
                    : key.startsWith("PULLCORD_") ? "PROYUBI_" + key.substring(9) : null;
                if (next != null && source.getProperty(next) == null) aliases.put(next, source.getProperty(key));
            }
            if (!aliases.isEmpty()) {
                String name = "proyubi-legacy:" + source.getName();
                PropertySource<?> alias = source instanceof SystemEnvironmentPropertySource
                    ? new SystemEnvironmentPropertySource(name, aliases) : new MapPropertySource(name, aliases);
                // Preserve source priority; an explicit new key in the same source always wins.
                environment.getPropertySources().addBefore(source.getName(), alias);
            }
        }
    }
}
