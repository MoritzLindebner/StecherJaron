import { defineType, defineField } from 'sanity';

export const tattoo = defineType({
  name: 'tattoo',
  title: 'Portfolio-Bild',
  type: 'document',
  fields: [
    defineField({
      name: 'image',
      title: 'Bild',
      type: 'image',
      options: { hotspot: true },
      validation: (rule) => rule.required(),
    }),
    defineField({ name: 'alt', title: 'Bildbeschreibung (Alt-Text)', type: 'localeString' }),
    defineField({
      name: 'category',
      title: 'Kategorie',
      type: 'reference',
      to: [{ type: 'category' }],
      // Required: the category is the join key for the style filter — a tattoo
      // without one silently drops out of the portfolio.
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'order',
      title: 'Reihenfolge',
      type: 'number',
      description: 'Kleinere Zahl = weiter vorne im Portfolio.',
    }),
  ],
  orderings: [
    { title: 'Reihenfolge', name: 'orderAsc', by: [{ field: 'order', direction: 'asc' }] },
  ],
  preview: {
    select: { alt: 'alt.de', category: 'category.title', media: 'image', order: 'order' },
    prepare({ alt, category, media, order }) {
      // The home page shows positions 1–3 before "Mehr anzeigen" (a fourth on
      // desktop). Spelling that out here is the only place it is visible while
      // scrolling the list — see GalleryPreview.tsx.
      const headliner =
        typeof order !== 'number'
          ? 'ohne Reihenfolge — steht ganz hinten'
          : order <= 3
            ? '★ Headliner — auf der Startseite'
            : order === 4
              ? '★ Headliner — nur am Rechner sichtbar'
              : alt || '';
      return {
        title: `${typeof order === 'number' ? `${order}.` : '–'} ${category || 'ohne Kategorie'}`,
        subtitle: headliner,
        media,
      };
    },
  },
});
