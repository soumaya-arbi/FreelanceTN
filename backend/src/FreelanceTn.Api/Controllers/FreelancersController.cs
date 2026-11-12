using FreelanceTn.Api.Dtos.Freelancers;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/freelancers")]
public class FreelancersController : ControllerBase
{
    private readonly AuthService _authService;

    public FreelancersController(AuthService authService)
    {
        _authService = authService;
    }

    /// <summary>
    /// Annuaire public des freelances. Chaque entrée est une projection
    /// restreinte : aucune donnée de connexion n'est exposée.
    /// </summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var users = await _authService.ListFreelancersAsync(cancellationToken);
        var items = users.Select(user =>
        {
            var name = $"{user.FirstName} {user.LastName}".Trim();
            return new PublicFreelancerSummaryResponse
            {
                Id = user.Id,
                Name = string.IsNullOrWhiteSpace(name) ? "Freelancer" : name,
                Title = user.Title,
                Location = user.Location,
                Avatar = user.Avatar,
                CoverImage = user.CoverImage ?? string.Empty,
                AvatarSource = string.IsNullOrWhiteSpace(user.AvatarSource) ? "initials" : user.AvatarSource,
                AvatarConfig = user.AvatarConfig,
                HourlyRate = user.HourlyRate,
                Skills = user.Skills,
            };
        }).ToList();
        return Ok(items);
    }

    /// <summary>
    /// Profil public d'un freelance, utilisé par la page publique et par la
    /// fiche talent côté client. La réponse ne contient que des champs publics.
    /// </summary>
    [HttpGet("{id}")]
    [AllowAnonymous]
    public async Task<IActionResult> Get(string id, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(id, out _))
        {
            throw new NotFoundException("Freelance introuvable.");
        }

        var user = await _authService.GetByIdAsync(id, cancellationToken);
        if (user is null || !string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new NotFoundException("Freelance introuvable.");
        }

        var name = $"{user.FirstName} {user.LastName}".Trim();

        return Ok(new PublicFreelancerResponse
        {
            Id = user.Id,
            Name = string.IsNullOrWhiteSpace(name) ? "Freelancer" : name,
            Title = user.Title,
            Location = user.Location,
            Bio = user.Bio,
            Avatar = user.Avatar,
            CoverImage = user.CoverImage ?? string.Empty,
            AvatarSource = string.IsNullOrWhiteSpace(user.AvatarSource) ? "initials" : user.AvatarSource,
            AvatarConfig = user.AvatarConfig,
            Skills = user.Skills,
            HourlyRate = user.HourlyRate,
            Experiences = user.Experiences.Select(e => new Dtos.Auth.CvExperienceDto
            {
                Id = e.Id,
                Role = e.Role,
                Company = e.Company,
                Location = e.Location,
                Period = e.Period,
                StartDate = e.StartDate,
                EndDate = e.EndDate,
                IsCurrent = e.IsCurrent,
                Technologies = e.Technologies,
                Description = e.Description,
            }).ToList(),
            Education = user.Education.Select(e => new Dtos.Auth.CvEducationDto
            {
                Id = e.Id,
                Degree = e.Degree,
                Institution = e.Institution,
                Specialty = e.Specialty,
                Location = e.Location,
                Period = e.Period,
                StartDate = e.StartDate,
                EndDate = e.EndDate,
                Description = e.Description,
            }).ToList(),
            Languages = user.Languages.Select(l => new Dtos.Auth.CvLanguageDto
            {
                Id = l.Id,
                Name = l.Name,
                Level = l.Level,
            }).ToList(),
            Certifications = user.Certifications.Select(c => new Dtos.Auth.CvCertificationDto
            {
                Id = c.Id,
                Name = c.Name,
                Issuer = c.Issuer,
                Year = c.Year,
            }).ToList(),
            WorkPreferences = new Dtos.Auth.CvWorkPreferencesDto
            {
                ProjectTypes = user.WorkPreferences.ProjectTypes,
                WorkPreference = user.WorkPreferences.WorkPreference,
                MinimumBudget = user.WorkPreferences.MinimumBudget,
            },
            CreatedAt = user.CreatedAt,
        });
    }
}
