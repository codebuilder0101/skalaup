import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Star, Loader2, CheckCircle2, Frown, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getPublicRatingTarget, submitPublicRating, deviceHash,
  type PublicRatingTarget,
} from "@/lib/skalaup/publicRatings";

// Public, unauthenticated rating page reached by scanning a freelancer's QR
// (/rate/:token). Mobile-first. Ratings are informational only (never scored).
export default function PublicRatingPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();

  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<PublicRatingTarget | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data, error } = await getPublicRatingTarget(token);
      if (error || !data) setInvalid(true);
      else setTarget(data);
      setLoading(false);
    })();
  }, [token]);

  const submit = async () => {
    if (stars < 1) { setError(t("skala.publicRating.pickStars")); return; }
    setSubmitting(true);
    setError(null);
    const { error } = await submitPublicRating(token, {
      stars, comment: comment.trim() || null, deviceHash: deviceHash(),
    });
    setSubmitting(false);
    if (error) {
      // 409 = already rated today → terminal state, not a retryable inline error.
      if (error.status === 409) { setAlreadyRated(true); return; }
      setError(error.message);
      return;
    }
    setDone(true);
  };

  const shown = hover || stars;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("skala.common.loading")}
          </div>
        ) : invalid ? (
          <div className="py-8 text-center">
            <Frown className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">{t("skala.publicRating.invalid")}</p>
          </div>
        ) : done ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">{t("skala.publicRating.thanksTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("skala.publicRating.thanksBody")}</p>
          </div>
        ) : alreadyRated ? (
          <div className="py-8 text-center">
            <BadgeCheck className="mx-auto h-12 w-12 text-primary" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">{t("skala.publicRating.alreadyRatedTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("skala.publicRating.alreadyRatedBody")}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center text-center">
              {target?.photoUrl ? (
                <img src={target.photoUrl} alt={target?.name ?? ""}
                  className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/20" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">
                  {(target?.name ?? "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">{t("skala.publicRating.rating")}</p>
              <h1 className="text-xl font-bold text-foreground">{target?.name}</h1>
            </div>

            <div className="mt-6 flex justify-center gap-1.5" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n}`}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setStars(n)}
                  className="p-1"
                >
                  <Star className={`h-9 w-9 transition-colors ${n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
                </button>
              ))}
            </div>

            <div className="mt-5">
              <Textarea
                rows={3}
                value={comment}
                maxLength={1000}
                placeholder={t("skala.publicRating.commentPlaceholder")}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {error && <p className="mt-3 text-center text-sm text-rose-600">{error}</p>}

            <Button className="mt-5 w-full" onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t("skala.publicRating.submit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
