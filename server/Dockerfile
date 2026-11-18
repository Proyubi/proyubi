# ---- Build Stage ----
FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /build

COPY pom.xml ./
COPY proyubi-common-core ./proyubi-common-core
COPY proyubi-common-web ./proyubi-common-web
COPY proyubi-common-satoken ./proyubi-common-satoken
COPY proyubi-common-mybatis-flex ./proyubi-common-mybatis-flex
COPY proyubi-common-redis ./proyubi-common-redis
COPY proyubi-capabilities ./proyubi-capabilities
COPY proyubi-regions ./proyubi-regions
COPY proyubi-identity ./proyubi-identity
COPY proyubi-platform ./proyubi-platform
COPY proyubi-pm ./proyubi-pm
COPY proyubi-server ./proyubi-server

# BuildKit cache 缓存 ~/.m2，加速二次构建
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -P prod -pl proyubi-server -am clean package -DskipTests

# ---- Run Stage ----
FROM eclipse-temurin:17-jre

WORKDIR /app

# healthcheck 用 curl
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV SPRING_PROFILES_ACTIVE=prod \
    SERVER_PORT=38082 \
    JAVA_OPTS="-XX:MaxRAMPercentage=70.0 -Djava.security.egd=file:/dev/./urandom"

COPY --from=builder /build/proyubi-server/target/proyubi-server-*.jar app.jar

EXPOSE 38082

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
