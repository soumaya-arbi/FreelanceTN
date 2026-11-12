using FluentValidation.TestHelper;
using FreelanceTn.Api.Dtos.Account;
using FreelanceTn.Api.Validators;

namespace FreelanceTn.Api.Tests;

public class AccountValidatorsTests
{
    private readonly UpdateClientProfileRequestValidator _profile = new();
    private readonly UserPreferencesDtoValidator _preferences = new();
    private readonly ChangePasswordRequestValidator _password = new();
    private readonly UpdateBillingRequestValidator _billing = new();

    [Theory]
    [InlineData("https://entreprise.tn")]
    [InlineData("http://www.entreprise.tn/contact")]
    public void Profil_accepte_les_urls_http_et_https(string website)
    {
        var result = _profile.TestValidate(new UpdateClientProfileRequest { CompanyWebsite = website });
        result.ShouldNotHaveValidationErrorFor(x => x.CompanyWebsite);
    }

    [Theory]
    [InlineData("entreprise.tn")]
    [InlineData("javascript:alert(1)")]
    public void Profil_refuse_les_urls_invalides(string website)
    {
        var result = _profile.TestValidate(new UpdateClientProfileRequest { CompanyWebsite = website });
        result.ShouldHaveValidationErrorFor(x => x.CompanyWebsite);
    }

    [Theory]
    [InlineData("#5145e5")]
    [InlineData("#FFFFFF")]
    public void Profil_accepte_une_couleur_hexadecimale(string color)
    {
        var result = _profile.TestValidate(new UpdateClientProfileRequest { AvatarColor = color });
        result.ShouldNotHaveValidationErrorFor(x => x.AvatarColor);
    }

    [Theory]
    [InlineData("red")]
    [InlineData("#12345")]
    [InlineData("#GGGGGG")]
    public void Profil_refuse_une_couleur_invalide(string color)
    {
        var result = _profile.TestValidate(new UpdateClientProfileRequest { AvatarColor = color });
        result.ShouldHaveValidationErrorFor(x => x.AvatarColor);
    }

    [Fact]
    public void Profil_refuse_un_email_professionnel_invalide()
    {
        var result = _profile.TestValidate(new UpdateClientProfileRequest { ProfessionalEmail = "pas-un-email" });
        result.ShouldHaveValidationErrorFor(x => x.ProfessionalEmail);
    }

    [Fact]
    public void Preferences_imposent_la_devise_TND_et_les_valeurs_supportees()
    {
        var result = _preferences.TestValidate(new UserPreferencesDto
        {
            Language = "fr",
            Currency = "USD",
            Theme = "light",
            Timezone = "Africa/Tunis",
            DateFormat = "DD/MM/YYYY",
        });

        result.ShouldHaveValidationErrorFor(x => x.Currency);
    }

    [Fact]
    public void Preferences_acceptent_les_valeurs_reelles_de_la_plateforme()
    {
        var result = _preferences.TestValidate(new UserPreferencesDto
        {
            Language = "en",
            Currency = "TND",
            Theme = "dark",
            Timezone = "Africa/Tunis",
            DateFormat = "YYYY-MM-DD",
        });

        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Changement_de_mot_de_passe_exige_huit_caracteres()
    {
        var result = _password.TestValidate(new ChangePasswordRequest
        {
            CurrentPassword = "ancien-mot-de-passe",
            NewPassword = "court",
        });

        result.ShouldHaveValidationErrorFor(x => x.NewPassword);
    }

    [Fact]
    public void Changement_de_mot_de_passe_refuse_l_identique()
    {
        var result = _password.TestValidate(new ChangePasswordRequest
        {
            CurrentPassword = "mot-de-passe-2026",
            NewPassword = "mot-de-passe-2026",
        });

        result.ShouldHaveValidationErrorFor(x => x.NewPassword);
    }

    [Fact]
    public void Facturation_refuse_un_email_de_contact_invalide()
    {
        var result = _billing.TestValidate(new UpdateBillingRequest { ContactEmail = "contact@" });
        result.ShouldHaveValidationErrorFor(x => x.ContactEmail);
    }

    [Fact]
    public void Facturation_accepte_un_email_de_contact_valide()
    {
        var result = _billing.TestValidate(new UpdateBillingRequest { ContactEmail = "facturation@entreprise.tn" });
        result.ShouldNotHaveValidationErrorFor(x => x.ContactEmail);
    }
}
