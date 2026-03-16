FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY apps/apis/conveymate-api/src/ConveyMate.Api/ConveyMate.Api.csproj apps/apis/conveymate-api/src/ConveyMate.Api/
RUN dotnet restore apps/apis/conveymate-api/src/ConveyMate.Api/ConveyMate.Api.csproj

RUN rm -rf apps/apis/conveymate-api/src/ConveyMate.Api
COPY apps/apis/conveymate-api/src/ConveyMate.Api/ apps/apis/conveymate-api/src/ConveyMate.Api/
RUN dotnet publish apps/apis/conveymate-api/src/ConveyMate.Api/ConveyMate.Api.csproj \
    -c Release \
    -o /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.2
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:9222
ENV DOTNET_EnableDiagnostics=0

COPY --from=build /app/publish/ ./

EXPOSE 8081

ENTRYPOINT ["dotnet", "ConveyMate.Api.dll"]
