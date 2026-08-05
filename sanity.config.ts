'use client';

import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { UploadIcon } from '@sanity/icons';
import { schemaTypes } from './sanity/schemas';
import BatchUpload from './sanity/tools/BatchUpload';
import { projectId, dataset, apiVersion } from './sanity/env';

// Singletons: exactly one document, edited in place (fixed documentId). They must
// not be created anew, duplicated, or deleted from the UI.
const SINGLETONS = ['siteSettings', 'about', 'howToBook'];

export default defineConfig({
  name: 'stecher-jaron',
  title: 'Stecher Jaron',
  // 'placeholder' keeps builds green until the real id is set in .env.local
  projectId: projectId || 'placeholder',
  dataset,
  basePath: '/studio',
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Inhalt')
          .items([
            // First entry, not a tool tab: on a phone the content list is the
            // opening screen, so batch upload is one tap away.
            S.listItem()
              .title('Bilder hochladen')
              .id('batch-upload')
              .icon(UploadIcon)
              .child(S.component(BatchUpload).id('batch-upload').title('Bilder hochladen')),
            S.divider(),
            S.listItem()
              .title('Einstellungen')
              .id('siteSettings')
              .child(S.document().schemaType('siteSettings').documentId('siteSettings')),
            S.divider(),
            S.listItem()
              .title('Über mich')
              .id('about')
              .child(S.document().schemaType('about').documentId('about')),
            S.listItem()
              .title('How to Book')
              .id('howToBook')
              .child(S.document().schemaType('howToBook').documentId('howToBook')),
            S.divider(),
            S.documentTypeListItem('category').title('Kategorien'),
            // Sorted by "Reihenfolge", not by last edit: the headliner badge in
            // the preview only helps if position 1 is actually the top row.
            S.listItem()
              .title('Portfolio')
              .schemaType('tattoo')
              .child(
                S.documentTypeList('tattoo')
                  .title('Portfolio')
                  .defaultOrdering([{ field: 'order', direction: 'asc' }]),
              ),
            S.documentTypeListItem('wannados').title('Wannado’s'),
            S.documentTypeListItem('studioImage').title('Studio-Fotos'),
            S.documentTypeListItem('event').title('Events'),
          ]),
    }),
    visionTool({ defaultApiVersion: apiVersion }),
  ],
  // Hide singletons from the global "New document" menu…
  document: {
    newDocumentOptions: (prev) =>
      prev.filter((tpl) => !SINGLETONS.includes(tpl.templateId)),
    // …and remove create/duplicate/delete actions on the singleton documents.
    actions: (prev, { schemaType }) =>
      SINGLETONS.includes(schemaType)
        ? prev.filter(
            (action) => !['duplicate', 'delete', 'unpublish'].includes(action.action as string),
          )
        : prev,
  },
  schema: { types: schemaTypes },
});
