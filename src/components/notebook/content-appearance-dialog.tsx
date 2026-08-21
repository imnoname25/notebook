"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import {
  ACCENT_BG_CLASSES,
  ACCENT_COLORS,
  ACCENT_LABELS,
  isAccentColor,
  PAGE_APPEARANCE_PRESETS,
  PAGE_BACKGROUND_OVERLAYS,
  PAGE_BACKGROUND_POSITIONS,
  PAGE_BACKGROUND_TYPES,
  PAGE_GRADIENT_LABELS,
  PAGE_GRADIENTS,
  PAGE_PATTERN_LABELS,
  PAGE_PATTERNS,
  PAGE_PRESET_LABELS,
  pagePresetAppearance,
  resetPageAppearance,
  valueFromAllowlist,
  type AccentColor,
  type PageAppearancePreset,
} from "@/lib/content-appearance";
import { t } from "@/lib/i18n/messages";
import { SECTION_ICONS, resolveSectionIcon, type SectionIconId } from "@/lib/section-icons";
import { cn } from "@/lib/utils";
import { SECTION_ICON_COMPONENTS } from "./section-icon";
import type { PageSummary, Section } from "./types";

const PAGE_ICONS = [
  "",
  "📝",
  "📌",
  "💡",
  "✅",
  "📚",
  "🗂️",
  "💻",
  "🛠️",
  "🏠",
  "💼",
  "🔒",
  "⭐",
  "❤️",
  "🌍",
  "🚀",
];
type Width = "narrow" | "normal" | "wide";

function ColorPicker({
  value,
  onChange,
  label = t("appearance.color"),
}: {
  value: AccentColor;
  onChange(value: AccentColor): void;
  label?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-7 gap-2">
        {ACCENT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={ACCENT_LABELS[color]}
            aria-label={ACCENT_LABELS[color]}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
            className={cn(
              "flex size-10 items-center justify-center rounded-md ring-offset-2 ring-offset-card transition-transform hover:scale-105",
              ACCENT_BG_CLASSES[color],
              value === color && "ring-2 ring-primary",
            )}
          >
            {value === color && (
              <Check
                size={15}
                className={
                  color === "default" ? "text-foreground" : "text-white"
                }
              />
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function SectionAppearanceDialog({
  section,
  onClose,
  onSaved,
  onError,
}: {
  section: Section;
  onClose(): void;
  onSaved(section: Section): void;
  onError(error: unknown): void;
}) {
  const [color, setColor] = useState<AccentColor>(
    isAccentColor(section.color) ? section.color : "default",
  );
  const [icon, setIcon] = useState<SectionIconId>(resolveSectionIcon(section.icon));
  const [busy, setBusy] = useState(false);
  async function choose(next: AccentColor) {
    const previous = color;
    setColor(next);
    setBusy(true);
    try {
      const result = await api<{ section: Section }>(
        `/api/sections/${section.id}`,
        jsonOptions("PATCH", { color: next }),
      );
      onSaved(result.section);
    } catch (error) {
      setColor(previous);
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function chooseIcon(next: SectionIconId) {
    const previous = icon;
    setIcon(next);
    setBusy(true);
    try {
      const result = await api<{ section: Section }>(
        `/api/sections/${section.id}`,
        jsonOptions("PATCH", { icon: next }),
      );
      onSaved(result.section);
    } catch (error) {
      setIcon(previous);
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <Dialog.Content
          aria-describedby={undefined}
          className="notebook-mobile-sheet fixed bottom-0 left-0 z-50 w-full rounded-t-xl bg-card p-5 shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <header className="mb-5 flex items-center">
            <Dialog.Title className="min-w-0 flex-1 truncate font-semibold">
              {t("appearance.sectionTitle")} · {section.title}
            </Dialog.Title>
            {busy && <Loader2 size={16} className="mr-2 animate-spin" />}
            <Dialog.Close
              className="flex size-11 items-center justify-center rounded-md hover:bg-accent"
              aria-label={t("common.close")}
            >
              <X size={18} />
            </Dialog.Close>
          </header>
          <fieldset className="mb-5">
            <legend className="mb-2 text-sm font-medium">{t("appearance.sectionIcon")}</legend>
            <div className="grid grid-cols-8 gap-1.5">
              {SECTION_ICONS.map((item) => {
                const Icon = SECTION_ICON_COMPONENTS[item];
                return (
                  <button key={item} type="button" aria-label={t(`sectionIcon.${item}`)} aria-pressed={icon === item} title={t(`sectionIcon.${item}`)} onClick={() => void chooseIcon(item)} className={cn("flex size-10 items-center justify-center rounded-md hover:bg-accent", icon === item && "bg-accent ring-2 ring-primary")}>
                    <Icon size={18} />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <ColorPicker value={color} onChange={(next) => void choose(next)} />
          <p className="mt-4 text-sm text-muted-foreground">
            {t("appearance.sectionHint")}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChoiceGrid<T extends string>({
  values,
  value,
  label,
  getLabel,
  onChange,
  previewClass,
}: {
  values: readonly T[];
  value: T | null;
  label: string;
  getLabel(value: T): string;
  onChange(value: T): void;
  previewClass?: (value: T) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {values.map((item) => (
          <button
            key={item}
            type="button"
            aria-label={getLabel(item)}
            aria-pressed={value === item}
            onClick={() => onChange(item)}
            className={cn(
              "min-h-12 rounded-lg border border-border/60 px-3 py-2 text-left text-sm hover:bg-accent",
              previewClass?.(item),
              value === item && "ring-2 ring-primary",
            )}
          >
            {getLabel(item)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function PageAppearanceDialog({
  page,
  onClose,
  onSaved,
  onError,
}: {
  page: PageSummary;
  onClose(): void;
  onSaved(page: PageSummary): void;
  onError(error: unknown): void;
}) {
  const [draft, setDraft] = useState(page);
  const [width, setWidth] = useState<Width>("normal");
  const [busy, setBusy] = useState("");
  const mutationSequence = useRef(0);
  useEffect(() => {
    void api<{ settings: { editorContentWidth: Width } }>(
      "/api/account/preferences",
    ).then(({ settings }) => setWidth(settings.editorContentWidth));
  }, []);

  async function persist(patch: Partial<PageSummary>) {
    const sequence = ++mutationSequence.current;
    const previous = draft;
    const optimistic = { ...draft, ...patch };
    setDraft(optimistic);
    onSaved(optimistic);
    setBusy("appearance");
    try {
      const { page: saved } = await api<{ page: PageSummary }>(
        `/api/pages/${page.id}`,
        jsonOptions("PATCH", patch),
      );
      if (mutationSequence.current === sequence) {
        setDraft(saved);
        onSaved(saved);
      }
    } catch (error) {
      if (mutationSequence.current === sequence) {
        setDraft(previous);
        onSaved(previous);
        onError(error);
      }
    } finally {
      if (mutationSequence.current === sequence) setBusy("");
    }
  }
  async function chooseWidth(next: Width) {
    const previous = width;
    setWidth(next);
    setBusy("width");
    try {
      await api(
        "/api/account/preferences",
        jsonOptions("PATCH", { editorContentWidth: next }),
      );
    } catch (error) {
      setWidth(previous);
      onError(error);
    } finally {
      setBusy("");
    }
  }
  async function upload(file: File, target: "cover" | "background") {
    setBusy(target);
    const form = new FormData();
    form.append("file", file);
    form.append("pageId", page.id);
    try {
      const result = await api<{ id: string }>("/api/uploads", {
        method: "POST",
        body: form,
      });
      await persist(
        target === "cover"
          ? { coverUploadId: result.id }
          : {
              backgroundUploadId: result.id,
              backgroundType: "image",
              backgroundOverlay: "medium",
            },
      );
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }
  function applyPreset(preset: PageAppearancePreset) {
    void persist({ ...pagePresetAppearance(preset), backgroundUploadId: null });
  }
  function reset() {
    void persist({ icon: null, coverUploadId: null, ...resetPageAppearance() });
  }

  const accent = isAccentColor(draft.color) ? draft.color : "default";
  const backgroundType = valueFromAllowlist(
    draft.backgroundType,
    PAGE_BACKGROUND_TYPES,
    "default",
  );
  const backgroundColor = valueFromAllowlist(
    draft.backgroundColor,
    ACCENT_COLORS,
    "default",
  );
  const gradient = valueFromAllowlist(
    draft.backgroundGradient,
    PAGE_GRADIENTS,
    "dusk",
  );
  const pattern = valueFromAllowlist(
    draft.backgroundPattern,
    PAGE_PATTERNS,
    "plain",
  );
  const position = valueFromAllowlist(
    draft.backgroundPosition,
    PAGE_BACKGROUND_POSITIONS,
    "center",
  );
  const overlay = valueFromAllowlist(
    draft.backgroundOverlay,
    PAGE_BACKGROUND_OVERLAYS,
    "medium",
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <Dialog.Content
          aria-describedby={undefined}
          className="notebook-mobile-sheet fixed inset-x-0 bottom-0 z-50 max-h-[min(88dvh,760px)] overflow-y-auto rounded-t-2xl bg-card p-5 shadow-2xl sm:bottom-auto sm:left-auto sm:right-6 sm:top-1/2 sm:w-[520px] sm:-translate-y-1/2 sm:rounded-xl"
        >
          <header className="sticky top-0 z-10 -mx-1 mb-5 flex items-center bg-card/95 px-1 py-1 backdrop-blur">
            <Dialog.Title className="min-w-0 flex-1 truncate font-semibold">
              {t("appearance.pageTitle")} · {page.title}
            </Dialog.Title>
            {busy && <Loader2 size={16} className="mr-2 animate-spin" />}
            <Dialog.Close
              className="flex size-11 items-center justify-center rounded-md hover:bg-accent"
              aria-label={t("common.close")}
            >
              <X size={18} />
            </Dialog.Close>
          </header>
          <div className="space-y-6">
            <ChoiceGrid
              values={PAGE_APPEARANCE_PRESETS}
              value={valueFromAllowlist(
                draft.appearancePreset,
                PAGE_APPEARANCE_PRESETS,
                "default",
              )}
              label={t("appearance.presets")}
              getLabel={(item) => PAGE_PRESET_LABELS[item]}
              onChange={applyPreset}
              previewClass={(item) => `appearance-preset-card appearance-preset-${item}`}
            />
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                {t("appearance.icon")}
              </legend>
              <div className="grid grid-cols-8 gap-2">
                {PAGE_ICONS.map((item) => (
                  <button
                    key={item || "none"}
                    type="button"
                    aria-label={item || t("appearance.noIcon")}
                    aria-pressed={(draft.icon ?? "") === item}
                    onClick={() =>
                      void persist({
                        icon: item || null,
                        appearancePreset: null,
                      })
                    }
                    className={cn(
                      "flex size-10 items-center justify-center rounded-md bg-muted text-lg hover:bg-accent",
                      (draft.icon ?? "") === item && "ring-2 ring-primary",
                    )}
                  >
                    {item || <X size={14} />}
                  </button>
                ))}
              </div>
            </fieldset>
            <ColorPicker
              value={accent}
              onChange={(color) =>
                void persist({ color, appearancePreset: null })
              }
              label={t("appearance.pageAccent")}
            />
            <ChoiceGrid
              values={PAGE_BACKGROUND_TYPES}
              value={backgroundType}
              label={t("appearance.background")}
              getLabel={(item) =>
                ({
                  default: t("appearance.backgroundDefault"),
                  solid: t("appearance.backgroundSolid"),
                  tint: t("appearance.backgroundTint"),
                  gradient: t("appearance.backgroundGradientType"),
                  image: t("appearance.backgroundImageType"),
                  pattern: t("appearance.backgroundPatternType"),
                })[item]
              }
              onChange={(backgroundType) =>
                void persist({ backgroundType, appearancePreset: null })
              }
            />
            {(backgroundType === "solid" ||
              backgroundType === "tint" ||
              backgroundType === "pattern") && (
              <ColorPicker
                value={backgroundColor}
                onChange={(backgroundColor) =>
                  void persist({ backgroundColor, appearancePreset: null })
                }
                label={t("appearance.backgroundTone")}
              />
            )}
            {backgroundType === "gradient" && (
              <ChoiceGrid
                values={PAGE_GRADIENTS}
                value={gradient}
                label={t("appearance.gradient")}
                getLabel={(item) => PAGE_GRADIENT_LABELS[item]}
                onChange={(backgroundGradient) =>
                  void persist({ backgroundGradient, appearancePreset: null })
                }
                previewClass={(item) => `appearance-gradient-${item}`}
              />
            )}
            {backgroundType === "pattern" && (
              <ChoiceGrid
                values={PAGE_PATTERNS}
                value={pattern}
                label={t("appearance.pattern")}
                getLabel={(item) => PAGE_PATTERN_LABELS[item]}
                onChange={(backgroundPattern) =>
                  void persist({ backgroundPattern, appearancePreset: null })
                }
                previewClass={(item) => `appearance-pattern-${item}`}
              />
            )}
            {backgroundType === "image" && (
              <fieldset>
                <legend className="mb-2 text-sm font-medium">
                  {t("appearance.backgroundImage")}
                </legend>
                {draft.backgroundUploadId && (
                  <div
                    className="mb-3 h-28 rounded-lg bg-cover bg-center"
                    style={{
                      backgroundImage: `url(/api/uploads/${draft.backgroundUploadId})`,
                    }}
                  />
                )}
                <UploadButton
                  busy={busy === "background"}
                  onFile={(file) => void upload(file, "background")}
                />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Select
                    label={t("appearance.position")}
                    value={position}
                    values={PAGE_BACKGROUND_POSITIONS}
                    labels={{
                      top: t("appearance.positionTop"),
                      center: t("appearance.positionCenter"),
                      bottom: t("appearance.positionBottom"),
                    }}
                    onChange={(backgroundPosition) =>
                      void persist({ backgroundPosition })
                    }
                  />
                  <Select
                    label={t("appearance.overlay")}
                    value={overlay}
                    values={PAGE_BACKGROUND_OVERLAYS}
                    labels={{
                      none: t("appearance.overlayNone"),
                      light: t("appearance.overlayLight"),
                      medium: t("appearance.overlayMedium"),
                      strong: t("appearance.overlayStrong"),
                    }}
                    onChange={(backgroundOverlay) =>
                      void persist({ backgroundOverlay })
                    }
                  />
                </div>
                {draft.backgroundUploadId && (
                  <Button
                    className="mt-2"
                    variant="ghost"
                    onClick={() =>
                      void persist({
                        backgroundUploadId: null,
                        backgroundType: "default",
                      })
                    }
                  >
                    {t("appearance.removeBackground")}
                  </Button>
                )}
              </fieldset>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                {t("appearance.cover")}
              </legend>
              {draft.coverUploadId && (
                <div
                  className="mb-3 h-28 rounded-lg bg-cover bg-center"
                  style={{
                    backgroundImage: `url(/api/uploads/${draft.coverUploadId})`,
                  }}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <UploadButton
                  busy={busy === "cover"}
                  onFile={(file) => void upload(file, "cover")}
                />
                {draft.coverUploadId && (
                  <Button
                    variant="ghost"
                    onClick={() => void persist({ coverUploadId: null })}
                  >
                    {t("appearance.removeCover")}
                  </Button>
                )}
              </div>
            </fieldset>
            <Select
              label={t("appearance.pageWidth")}
              value={width}
              values={["narrow", "normal", "wide"] as const}
              labels={{
                narrow: t("appearance.widthNarrow"),
                normal: t("appearance.widthNormal"),
                wide: t("appearance.widthWide"),
              }}
              onChange={(next) => void chooseWidth(next)}
            />
            <div className="border-t border-border/60 pt-4">
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={reset}
              >
                <RotateCcw size={15} />
                {t("appearance.reset")}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function UploadButton({
  busy,
  onFile,
}: {
  busy: boolean;
  onFile(file: File): void;
}) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent">
      {busy ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <ImagePlus size={15} />
      )}
      {t("appearance.addOrReplace")}
      <input
        className="hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function Select<T extends string>({
  label,
  value,
  values,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  labels: Record<T, string>;
  onChange(value: T): void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-2 block font-medium">{label}</span>
      <select
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {values.map((item) => (
          <option key={item} value={item}>
            {labels[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
