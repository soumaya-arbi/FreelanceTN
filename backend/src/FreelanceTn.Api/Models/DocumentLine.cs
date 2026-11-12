using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public class DocumentLine
{
    [BsonElement("id")]
    public string Id { get; set; } = string.Empty;

    [BsonElement("description")]
    public string Description { get; set; } = string.Empty;

    [BsonElement("quantity")]
    public decimal Quantity { get; set; } = 1;

    [BsonElement("unitPrice")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal UnitPrice { get; set; }

    [BsonElement("taxRate")]
    public decimal TaxRate { get; set; }

    [BsonElement("discount")]
    public decimal Discount { get; set; }
}
