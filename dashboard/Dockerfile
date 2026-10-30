# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM eclipse-temurin:21-jdk-jammy AS backend
WORKDIR /build/backend
COPY backend/ ./
COPY --from=frontend /build/frontend/dist /build/frontend/dist
# bundleFrontend still copies dist into the JAR; Node runs only in the first stage.
RUN chmod +x gradlew && ./gradlew --no-daemon bootJar -x frontendBuild

FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
# The official Temurin Jammy image includes curl for the HTTP health check.
RUN command -v curl >/dev/null \
    && groupadd --gid 10001 dashboard \
    && useradd --uid 10001 --gid dashboard --home-dir /app --no-create-home --shell /usr/sbin/nologin dashboard
COPY --from=backend --chown=dashboard:dashboard /build/backend/build/libs/ai-security-dashboard.jar /app/dashboard.jar
USER dashboard:dashboard
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
    CMD ["curl", "--fail", "--silent", "--show-error", "http://127.0.0.1:8080/api/v1/health"]
ENTRYPOINT ["java", "-jar", "/app/dashboard.jar"]
