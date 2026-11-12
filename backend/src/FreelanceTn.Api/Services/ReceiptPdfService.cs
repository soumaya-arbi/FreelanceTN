using FreelanceTn.Api.Models;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Reçu PDF professionnel, généré à partir de l'instantané conservé dans la
/// transaction. Le même document est servi au client et au freelancer : aucune
/// donnée bancaire réelle n'y figure, uniquement les informations de la
/// transaction interne FreelanceTN.
/// </summary>
public class ReceiptPdfService
{
    private static readonly string Brand = "#5145E5";
    private static readonly string Ink = "#111827";
    private static readonly string Muted = "#667085";
    private static readonly string Border = "#E5E7EB";

    static ReceiptPdfService()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public byte[] Generate(PaymentTransaction transaction)
    {
        var amount = $"{transaction.Amount:0.000} TND";
        var balanceAfter = transaction.BalanceAfter.HasValue
            ? $"{transaction.BalanceAfter.Value:0.000} TND"
            : "—";
        var paidAt = (transaction.CompletedAt ?? transaction.UpdatedAt).ToLocalTime();

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(40);
                page.PageColor(Colors.White);
                page.DefaultTextStyle(style => style.FontSize(9.5f).FontColor(Ink).LineHeight(1.45f));

                page.Header().Element(header => ComposeHeader(header, transaction));
                page.Content().PaddingTop(22).Element(content =>
                    ComposeContent(content, transaction, amount, balanceAfter, paidAt));
                page.Footer().PaddingTop(12).Element(footer =>
                {
                    footer.BorderTop(0.5f).BorderColor(Border).PaddingTop(8).Row(row =>
                    {
                        row.RelativeItem().Text(text =>
                        {
                            text.Span("Document généré électroniquement par FreelanceTN — aucune signature manuscrite requise.")
                                .FontSize(7.5f).FontColor(Muted);
                        });
                        row.ConstantItem(90).AlignRight().Text(text =>
                        {
                            text.Span("Page ").FontSize(7.5f).FontColor(Muted);
                            text.CurrentPageNumber().FontSize(7.5f).FontColor(Muted);
                            text.Span(" / ").FontSize(7.5f).FontColor(Muted);
                            text.TotalPages().FontSize(7.5f).FontColor(Muted);
                        });
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    private static void ComposeHeader(IContainer container, PaymentTransaction transaction)
    {
        container.Column(column =>
        {
            column.Item().Row(row =>
            {
                row.ConstantItem(46).Height(46).Background(Brand).CornerRadius(10).AlignCenter().AlignMiddle()
                    .Text("FT").FontSize(16).Bold().FontColor(Colors.White);

                row.RelativeItem().PaddingLeft(12).Column(brand =>
                {
                    brand.Item().Text("FreelanceTN").FontSize(18).Bold().FontColor(Ink);
                    brand.Item().Text("Marketplace freelance tunisienne").FontSize(8.5f).FontColor(Muted);
                });

                row.ConstantItem(185).AlignRight().Column(meta =>
                {
                    meta.Item().AlignRight().Text("REÇU DE PAIEMENT").FontSize(11).Bold().FontColor(Brand);
                    meta.Item().AlignRight().Text(transaction.ReceiptNumber ?? "—").FontSize(9).FontColor(Muted);
                });
            });

            column.Item().PaddingTop(14).LineHorizontal(1.2f).LineColor(Brand);

            column.Item().PaddingTop(10).Row(row =>
            {
                row.RelativeItem().Text(text =>
                {
                    text.Span("Statut : ").FontSize(9).FontColor(Muted);
                    text.Span("PAYÉ").FontSize(9).Bold().FontColor("#067647");
                });
                row.ConstantItem(220).AlignRight().Text(text =>
                {
                    text.Span("Référence : ").FontSize(9).FontColor(Muted);
                    text.Span(transaction.Reference).FontSize(9).Bold().FontColor(Ink);
                });
            });
        });
    }

    private static void ComposeContent(
        IContainer container,
        PaymentTransaction transaction,
        string amount,
        string balanceAfter,
        DateTime paidAt)
    {
        container.Column(column =>
        {
            column.Spacing(14);

            column.Item().Background("#F7F8FC").Border(1).BorderColor(Border).CornerRadius(10).Padding(18).Column(box =>
            {
                box.Item().Text("Montant réglé").FontSize(9).FontColor(Muted);
                box.Item().PaddingTop(2).Text(amount).FontSize(26).Bold().FontColor(Brand);
                box.Item().PaddingTop(4).Text($"Facture {transaction.InvoiceNumber}  ·  {transaction.Currency}")
                    .FontSize(9).FontColor(Muted);
            });

            column.Item().Text("Détails de la transaction").FontSize(11).Bold().FontColor(Ink);

            column.Item().Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(1.1f);
                    columns.RelativeColumn(1.9f);
                });

                void Line(string label, string value)
                {
                    table.Cell().Background("#FAFAFD").BorderBottom(0.5f).BorderColor(Border).Padding(8)
                        .Text(label).FontSize(8.5f).FontColor(Muted);
                    table.Cell().BorderBottom(0.5f).BorderColor(Border).Padding(8)
                        .Text(value).FontSize(9).FontColor(Ink);
                }

                Line("Référence de transaction", transaction.Reference);
                Line("Date du paiement", paidAt.ToString("dd/MM/yyyy à HH:mm"));
                Line("Facture", transaction.InvoiceNumber);
                Line("Projet", string.IsNullOrWhiteSpace(transaction.ProjectTitle) ? "—" : transaction.ProjectTitle);
                Line("Client", transaction.ClientName);
                Line("Freelancer", transaction.FreelancerName);
                Line("Moyen de paiement", PaymentMethod.Label(transaction.Method));
                Line("Montant payé", amount);
                Line("Devise", transaction.Currency);
                Line("Statut", "Payé");
                Line("Solde restant après paiement", balanceAfter);
                if (!string.IsNullOrWhiteSpace(transaction.Note))
                {
                    Line("Note", transaction.Note!);
                }
            });

            column.Item().PaddingTop(4).Background("#EEF4FF").Border(1).BorderColor("#D9E4FF")
                .CornerRadius(8).Padding(11).Text(text =>
                {
                    text.Span("Ce reçu atteste l'enregistrement du paiement dans le parcours interne FreelanceTN. ")
                        .FontSize(8.5f).FontColor("#344054");
                    text.Span("Aucune coordonnée bancaire réelle n'est collectée ni conservée par la plateforme.")
                        .FontSize(8.5f).FontColor("#344054");
                });
        });
    }
}
