using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Services;
using MongoDB.Bson;
using MongoDB.Driver;

var mongoSettings = new MongoSettings
{
    ConnectionString = "mongodb://localhost:27017",
    DatabaseName = "freelancetn_dev",
    CountersCollection = "counters"
};
var options = Options.Create(mongoSettings);
var mongoContext = new MongoContext(options);
var invoiceService = new InvoiceService(mongoContext);

var year = DateTime.UtcNow.Year;
var filter = Builders<BsonDocument>.Filter.Eq("_id", $"invoice-{year}");
// Ensure clean state for this test (delete counter if exists)
await mongoContext.Counters.DeleteOneAsync(filter);
Console.WriteLine("Deleted any existing counter for the year.");

// Helper to invoke private GenerateNumberAsync via reflection
async Task<string> GetNumberAsync()
{
    var method = typeof(InvoiceService).GetMethod("GenerateNumberAsync", BindingFlags.NonPublic | BindingFlags.Instance);
    if (method == null) throw new Exception("GenerateNumberAsync not found");
    var task = (Task<string>)method.Invoke(invoiceService, new object[] { CancellationToken.None });
    return await task;
}

// Single call after deletion – should create counter and return 001
var first = await GetNumberAsync();
Console.WriteLine($"First generated number: {first}");

// Parallel calls
int parallelCalls = 5;
var tasks = Enumerable.Range(0, parallelCalls).Select(_ => GetNumberAsync()).ToArray();
var results = await Task.WhenAll(tasks);
Console.WriteLine("Parallel generated numbers:");
foreach (var num in results.OrderBy(n => n))
    Console.WriteLine(num);
