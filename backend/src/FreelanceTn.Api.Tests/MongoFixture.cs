using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Base MongoDB dédiée aux tests, créée pour la seule durée de la session de
/// test. La base de développement (<c>freelancetn_dev</c>) n'est jamais
/// sollicitée : la base de test porte un nom unique et est supprimée à la fin
/// des tests.
/// </summary>
public sealed class MongoFixture : IAsyncLifetime
{
    private const string ConnectionString = "mongodb://localhost:27017";

    private IMongoDatabase? _database;

    /// <summary>Nom de la base éphémère utilisée par les tests.</summary>
    public string DatabaseName { get; } = $"freelancetn_tests_{Guid.NewGuid():N}";

    /// <summary>Contexte Mongo configuré sur la base de test.</summary>
    public MongoContext Context { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        var settings = new MongoSettings
        {
            ConnectionString = ConnectionString,
            DatabaseName = DatabaseName,
        };

        Context = new MongoContext(Options.Create(settings));

        var client = new MongoClient(ConnectionString);
        _database = client.GetDatabase(DatabaseName);

        var reachable = await Context.PingAsync();
        if (!reachable)
        {
            throw new InvalidOperationException(
                "MongoDB est injoignable sur mongodb://localhost:27017 : les tests Projects ne peuvent pas s'exécuter.");
        }
    }

    public async Task DisposeAsync()
    {
        // Seule la base éphémère des tests est supprimée.
        if (_database is not null)
        {
            await _database.Client.DropDatabaseAsync(DatabaseName);
        }
    }

    /// <summary>Identifiant Mongo valide, utilisable comme identifiant de compte.</summary>
    public static string NewId() => ObjectId.GenerateNewId().ToString();
}
