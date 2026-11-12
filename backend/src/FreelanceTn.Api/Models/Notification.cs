using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public class Notification
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonRepresentation(BsonType.ObjectId)]
    public string RecipientId { get; set; } = null!;

    public string Type { get; set; } = string.Empty; // comment, status, review, approve, reject, assign
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string TaskId { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string TaskTitle { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;
    public string ActorName { get; set; } = string.Empty;
    public bool IsRead { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}