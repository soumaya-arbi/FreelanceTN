import { useEffect, useState } from "react";
import type { FC } from "react";
import { useRouter } from "next/navigation";
import { quotesApi } from "@/lib/api";
import type { QuoteApi } from "@/lib/api";
import { Button } from "@/components/ui/Button";

export const QuoteList: FC = () => {
  const [quotes, setQuotes] = useState<QuoteApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [converting, setConverting] = useState("");
  const router = useRouter();

  const load = async (cancelled?: () => boolean) => {
    try {
      const rows = await quotesApi.list();
      if (cancelled?.()) return;
      setQuotes(rows);
      setError("");
    } catch (err: unknown) {
      if (cancelled?.()) return;
      setError(err instanceof Error && err.message ? err.message : "Unable to load quotes.");
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    quotesApi
      .list()
      .then((rows) => {
        if (!active) return;
        setQuotes(rows);
        setError("");
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error && err.message ? err.message : "Unable to load quotes.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleEdit = (id: string) => router.push(`/freelancer/quotes/${id}`);

  const handleConvert = async (quote: QuoteApi) => {
    if (quote.status !== "accepted") {
      setError("Only accepted quotes can be converted to an invoice.");
      return;
    }
    setConverting(quote.id);
    setError("");
    try {
      await quotesApi.convertToInvoice(quote.id);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : "The quote could not be converted.");
    } finally {
      setConverting("");
    }
  };

  if (loading) return <div>Loading quotes…</div>;
  if (error && quotes.length === 0) return <p className="form-error" role="alert">{error}</p>;
  if (!quotes.length) return <div>No quotes found.</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Mes devis</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      <table className="min-w-full border">
        <thead>
          <tr className="bg-gray-100">
            <th className="p-2 text-left">Numéro</th>
            <th className="p-2 text-left">Client</th>
            <th className="p-2 text-left">Statut</th>
            <th className="p-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.id} className="border-t">
              <td className="p-2">{q.number}</td>
              <td className="p-2">{q.client}</td>
              <td className="p-2 capitalize">
                {q.convertedTo ? "Converted" : q.status}
              </td>
              <td className="p-2 space-x-2">
                <Button variant="secondary" onClick={() => handleEdit(q.id)}>
                  Modifier
                </Button>
                {q.status === "accepted" && !q.convertedTo && (
                  <Button
                    variant="primary"
                    disabled={converting === q.id}
                    onClick={() => handleConvert(q)}
                  >
                    {converting === q.id ? "Conversion…" : "Convertir en facture"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
