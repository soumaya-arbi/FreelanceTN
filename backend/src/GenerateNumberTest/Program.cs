using System;
using System.Reflection;
using System.Threading;
using Microsoft.Extensions.Options;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Services;

var mongoSettings = new MongoSettings
{
    ConnectionString = "mongodb://localhost:27017",
    DatabaseName = "freelancetn_dev",
    CountersCollection = "counters"
};
var options = Options.Create(mongoSettings);
var mongoContext = new MongoContext(options);
var invoiceService = new InvoiceService(mongoContext);

var method = typeof(InvoiceService).GetMethod("GenerateNumberAsync", BindingFlags.NonPublic | BindingFlags.Instance);
if (method == null) throw new Exception("GenerateNumberAsync method not found");
var task = (System.Threading.Tasks.Task<string>)method.Invoke(invoiceService, new object[] { CancellationToken.None });
var number = await task;
Console.WriteLine($"Generated invoice number: {number}");
