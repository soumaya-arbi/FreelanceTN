FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY backend/src/FreelanceTn.Api/FreelanceTn.Api.csproj ./
RUN dotnet restore FreelanceTn.Api.csproj

COPY backend/src/FreelanceTn.Api/ ./
RUN dotnet publish FreelanceTn.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfontconfig1 \
    libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish .

ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_HTTP_PORTS=8080

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "dotnet FreelanceTn.Api.dll --urls http://0.0.0.0:${PORT:-8080}"]
