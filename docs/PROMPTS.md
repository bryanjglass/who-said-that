# Question bank

Prompts live in [`shared/data/prompts.json`](../shared/data/prompts.json). The game ships with **120 original prompts**, 30 in each of four categories. They're written for ages 9 and up and are designed to produce short, distinctive answers.

## Format

```json
{
  "version": 1,
  "prompts": [
    { "id": "silly-001", "category": "silly", "text": "What's the worst possible name for a superhero?" },
    { "id": "family-014", "category": "family", "text": "What new rule would you add to our house?" }
  ]
}
```

| Field | Rules |
| --- | --- |
| `version` | Must be `1`. |
| `id` | Unique, 1–40 characters of `a-z`, `0-9` and `-`. Never reuse an id for a different question. |
| `category` | One of `silly`, `family`, `hypothetical` or `wildcard`. They're labelled Silly, Family, Hypothetical and Wild Card in the UI. |
| `text` | 10–120 characters, unique (ignoring case), ending in `?` or `.` |

## Adding prompts

1. Append entries to `prompts.json`.
2. Run `npm run validate:prompts`. This checks the schema and duplicates, makes sure every category still has at least 20 prompts, and runs a simple family-friendliness word filter.
3. Redeploy the Worker. The bank is bundled into the backend, and the server is what picks prompts.

The bank is validated when the module loads, so a malformed file fails immediately instead of producing a broken game.

## Writing good prompts

- Keep them open-ended but specific. "What's the worst name for a goldfish?" works better than "Say something funny."
- Aim for answers that fit in a sentence. The answer limit is 140 characters.
- Keep them family-friendly: no romance, violence, alcohol or mean-spirited targets.
- Questions about the family ("our house", "our family") work well because they make people's personalities show.

## How prompts are chosen

At game start the server takes every prompt in the categories the host selected, shuffles them with crypto-random numbers, and queues them. It prefers prompts not used in earlier games in the same room when enough remain. Skipped prompts count as used, so **no prompt repeats within a game**. Repeats are only allowed after every prompt in the selected categories has been used, which would take about 100 skips.
