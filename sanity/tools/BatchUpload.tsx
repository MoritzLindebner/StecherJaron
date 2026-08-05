import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Card, Flex, Grid, Inline, Select, Spinner, Stack, Text, useToast } from '@sanity/ui';
import { useClient } from 'sanity';
import { apiVersion } from '../env';

type Category = { _id: string; title: string };
type EventOption = { id: string; title: string };
type Item = {
  key: string;
  assetId: string;
  url: string;
  filename: string;
  categoryId?: string;
  selected: boolean;
};

const PORTFOLIO = 'portfolio';

const newKey = () => Math.random().toString(36).slice(2, 12);

/**
 * Runs `fn` over `list` with at most `n` in flight. The shared iterator hands
 * each worker the next item, so file order in the result stays intact.
 * ponytail: fixed concurrency of 3 — fine for a folder of phone photos.
 */
async function pool<T>(list: T[], n: number, fn: (item: T) => Promise<void>) {
  const it = list[Symbol.iterator]();
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (const item of it) await fn(item);
    }),
  );
}

/**
 * Batch-Upload: drop a folder of images, then assign a category per image
 * (Portfolio) or append them all to one event.
 *
 * Assets are uploaded immediately; the documents are only written on "anlegen".
 * ponytail: images removed before saving stay in the media library as orphans —
 * delete them there, or add a cleanup pass if it ever piles up.
 */
export default function BatchUpload() {
  const client = useClient({ apiVersion });
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [target, setTarget] = useState<string>(PORTFOLIO);
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client
      .fetch<{ categories: Category[]; events: { _id: string; title?: string }[] }>(
        `{
          "categories": *[_type == "category"] | order(order asc) {_id, title},
          "events": *[_type == "event"] | order(date desc) {_id, "title": title.de}
        }`,
      )
      .then(({ categories: cats, events: evts }) => {
        setCategories(cats);
        // Drafts and published copies both come back. Append to the draft when one
        // exists — patching the published copy would be overwritten on publish.
        const byBase = new Map<string, EventOption>();
        for (const e of evts) {
          const base = e._id.replace(/^drafts\./, '');
          if (!byBase.has(base) || e._id.startsWith('drafts.')) {
            byBase.set(base, { id: e._id, title: e.title || '(ohne Titel)' });
          }
        }
        setEvents([...byBase.values()]);
      })
      .catch((err) => toast.push({ status: 'error', title: 'Laden fehlgeschlagen', description: String(err) }));
  }, [client, toast]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!list.length) return;
      setProgress({ done: 0, total: list.length });
      const results: (Item | null)[] = new Array(list.length).fill(null);
      await pool(
        list.map((file, i) => [file, i] as const),
        3,
        async ([file, i]) => {
          try {
            const asset = await client.assets.upload('image', file, { filename: file.name });
            results[i] = {
              key: newKey(),
              assetId: asset._id,
              url: asset.url,
              filename: file.name,
              selected: false,
            };
          } catch (err) {
            toast.push({ status: 'error', title: `Upload fehlgeschlagen: ${file.name}`, description: String(err) });
          } finally {
            setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          }
        },
      );
      setItems((prev) => [...prev, ...(results.filter(Boolean) as Item[])]);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    },
    [client, toast],
  );

  const setSelection = (fn: (it: Item) => boolean) =>
    setItems((prev) => prev.map((it) => ({ ...it, selected: fn(it) })));

  const assign = (categoryId: string) =>
    setItems((prev) => prev.map((it) => (it.selected ? { ...it, categoryId, selected: false } : it)));

  const removeSelected = () => setItems((prev) => prev.filter((it) => !it.selected));

  const selectedCount = items.filter((it) => it.selected).length;
  const missingCategory = items.filter((it) => !it.categoryId).length;
  const catTitle = useMemo(
    () => Object.fromEntries(categories.map((c) => [c._id, c.title])),
    [categories],
  );

  const save = async () => {
    setSaving(true);
    try {
      if (target === PORTFOLIO) {
        // New images go to the end of the portfolio.
        const maxOrder = (await client.fetch<number | null>('math::max(*[_type == "tattoo"].order)')) ?? 0;
        const tx = items.reduce(
          (t, it, i) =>
            t.create({
              _type: 'tattoo',
              image: { _type: 'image', asset: { _type: 'reference', _ref: it.assetId } },
              category: { _type: 'reference', _ref: it.categoryId },
              alt: {
                _type: 'localeString',
                de: `${catTitle[it.categoryId!]} Tattoo`,
                en: `${catTitle[it.categoryId!]} tattoo`,
              },
              order: maxOrder + i + 1,
            }),
          client.transaction(),
        );
        await tx.commit();
      } else {
        await client
          .patch(target)
          .setIfMissing({ images: [] })
          .append(
            'images',
            items.map((it) => ({
              _key: newKey(),
              _type: 'image',
              asset: { _type: 'reference', _ref: it.assetId },
            })),
          )
          .commit();
      }
      toast.push({ status: 'success', title: `${items.length} Bilder gespeichert` });
      setItems([]);
    } catch (err) {
      toast.push({ status: 'error', title: 'Speichern fehlgeschlagen', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || progress !== null;

  return (
    <Box padding={4} style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Stack space={4}>
        <Stack space={3}>
          <Text weight="semibold" size={3}>
            Batch-Upload
          </Text>
          <Text size={1} muted>
            Bilder auswählen, danach Kategorie zuweisen. Gespeichert wird erst mit dem Knopf unten.
          </Text>
        </Stack>

        <Card padding={3} radius={2} shadow={1}>
          <Stack space={3}>
            <Text size={1} weight="medium">
              Ziel
            </Text>
            <Select
              value={target}
              onChange={(e) => setTarget(e.currentTarget.value)}
              disabled={busy || items.length > 0}
            >
              <option value={PORTFOLIO}>Portfolio</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  Event: {e.title}
                </option>
              ))}
            </Select>
            {items.length > 0 && (
              <Text size={1} muted>
                Ziel ist gesperrt, solange Bilder in der Liste stehen.
              </Text>
            )}
          </Stack>
        </Card>

        <Card
          padding={5}
          radius={2}
          border
          tone="transparent"
          style={{ textAlign: 'center', cursor: busy ? 'default' : 'pointer' }}
          onClick={() => !busy && fileRef.current?.click()}
          onDragOver={(e: React.DragEvent) => e.preventDefault()}
          onDrop={(e: React.DragEvent) => {
            e.preventDefault();
            if (!busy) handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.currentTarget.files)}
          />
          {progress ? (
            <Flex align="center" justify="center" gap={3}>
              <Spinner />
              <Text>
                Lade hoch … {progress.done} von {progress.total}
              </Text>
            </Flex>
          ) : (
            <Text muted>Bilder hierher ziehen oder klicken zum Auswählen</Text>
          )}
        </Card>

        {items.length > 0 && (
          <Stack space={3}>
            <Flex align="center" gap={2} wrap="wrap">
              <Text size={1}>
                {items.length} Bilder · {selectedCount} markiert
              </Text>
              <Button mode="ghost" text="Alle" onClick={() => setSelection(() => true)} disabled={busy} />
              <Button mode="ghost" text="Keins" onClick={() => setSelection(() => false)} disabled={busy} />
              {target === PORTFOLIO && missingCategory > 0 && (
                <Button
                  mode="ghost"
                  text={`Ohne Kategorie (${missingCategory})`}
                  onClick={() => setSelection((it) => !it.categoryId)}
                  disabled={busy}
                />
              )}
              <Button
                mode="ghost"
                tone="critical"
                text="Entfernen"
                onClick={removeSelected}
                disabled={busy || selectedCount === 0}
              />
            </Flex>

            {target === PORTFOLIO && (
              <Card padding={3} radius={2} shadow={1}>
                <Stack space={3}>
                  <Text size={1} weight="medium">
                    Kategorie für die markierten Bilder
                  </Text>
                  <Inline space={2}>
                    {categories.map((c) => (
                      <Button
                        key={c._id}
                        text={c.title}
                        tone="primary"
                        onClick={() => assign(c._id)}
                        disabled={busy || selectedCount === 0}
                      />
                    ))}
                  </Inline>
                </Stack>
              </Card>
            )}

            <Grid columns={[2, 3, 4, 6]} gap={2}>
              {items.map((it) => (
                <Card
                  key={it.key}
                  radius={2}
                  padding={1}
                  tone={it.selected ? 'primary' : 'default'}
                  border
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    setItems((prev) =>
                      prev.map((x) => (x.key === it.key ? { ...x, selected: !x.selected } : x)),
                    )
                  }
                >
                  <Stack space={2}>
                    <img
                      src={`${it.url}?w=240&h=240&fit=crop&auto=format`}
                      alt={it.filename}
                      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                    />
                    {target === PORTFOLIO && (
                      <Text size={0} align="center" muted={!it.categoryId}>
                        {it.categoryId ? catTitle[it.categoryId] : 'ohne Kategorie'}
                      </Text>
                    )}
                  </Stack>
                </Card>
              ))}
            </Grid>

            <Flex align="center" gap={3}>
              <Button
                text={saving ? 'Speichere …' : `${items.length} Bilder anlegen`}
                tone="positive"
                disabled={busy || (target === PORTFOLIO && missingCategory > 0)}
                onClick={save}
              />
              {target === PORTFOLIO && missingCategory > 0 && (
                <Text size={1} muted>
                  Noch {missingCategory} ohne Kategorie.
                </Text>
              )}
            </Flex>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
