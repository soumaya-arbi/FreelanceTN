using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public class TaskComment
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonRepresentation(BsonType.ObjectId)]
    public string TaskId { get; set; } = null!;

    [BsonRepresentation(BsonType.ObjectId)]
    public string ProjectId { get; set; } = null!;

    public string AuthorId { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public string AuthorAvatar { get; set; } = string.Empty;
    public string AuthorRole { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}