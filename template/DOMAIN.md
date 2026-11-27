# <Domain> Domain

<!-- One paragraph: the domain this system implements and why the model is shaped the way it is. -->

<!-- Replace `<entity>` throughout with the core noun of your domain, such as "account" or "order". -->

The code is the source of truth. Where this document and the code disagree, this document is stale and must be fixed. The authoritative definitions live in `<path to core model>`.

If a feature cannot be expressed within the model, change the model deliberately and update this document in the same change.

Every name in backticks in the command, event, transition, status and invariant tables must match `core/vocabulary.ts` exactly. The domain drift fitness function fails when a name exists on one side only.

---

## 1. What the domain is

<!-- What the domain owns, what it does not own and the central boundary everything else follows from. -->

### Ubiquitous language

Use these terms exactly. Do not introduce synonyms.

- **<Term>** - <definition>

---

## 2. The data model

### 2.1 The <entity>

<!-- if: event-sourcing -->
<!-- What the <entity> is made of: the immutable context record and the append-only event stream. How state is projected. -->
<!-- if: crud -->
<!-- What the <entity> record holds, its status field and how every write is guarded. -->
<!-- end -->

### 2.2 State

```ts
type <Entity>State = {
  // ...
};
```

<!-- Which fields are the truth about quantities that matter (money, balances, counts) and which events or transitions may change them. -->
<!-- Records of individual operations on the <entity>, each with its own status, and how they resolve. Delete if none. -->

### 2.3 Immutable context

<!-- The facts fixed when the <entity> is created and never changed afterwards. -->

### 2.4 Idempotency

<!-- The key that identifies a repeated command or request and what happens when it arrives again. -->

### 2.5 Persistence

| Key | Format          |
| --- | --------------- |
| PK  | `<ENTITY>#{id}` |
| SK  |                 |

<!-- Every secondary access pattern and the index that serves it. A new access pattern goes behind the store interface. -->

### 2.7 Data that is not domain state

<!-- Stores that sit beside the domain (audit, metadata, caches) and the rule that no decision may depend on them. Delete if none. -->

---

## 3. The engine

<!-- if: event-sourcing -->
```
Command ──▶ Decider ──▶ Event(s) ──▶ Evolve ──▶ State
```

### 3.1 Commands and events

<!-- Naming rules (imperative commands, past-tense events), the phases every operation follows (such as request, confirm and fail) and any exceptions. -->

| Command | Event |
| ------- | ----- |
|         |       |

### 3.2 Creation

<!-- How the <entity> is created and its context established. How this differs from every later command. -->

### 3.3 Decider

<!-- Signature, what it checks and how it rejects anything it cannot approve. -->

### 3.4 Evolve

<!-- Signature and what each event changes. -->

### 3.5 Features

<!-- Flags that change transition rules without forking the model. Delete if none. -->
<!-- if: crud -->
```
Request ──▶ Guard ──▶ Transition ──▶ Conditional write
```

### 3.1 Transitions

| From | Action | To  |
| ---- | ------ | --- |
|      |        |     |

### 3.2 Guard

<!-- Signature, what it checks and how it rejects anything it cannot approve. -->

### 3.3 Write

<!-- How a transition is applied atomically against the current status and version. -->
<!-- end -->

---

## 4. Lifecycle statuses

```
<status>
```

| Status | Meaning |
| ------ | ------- |
|        |         |

<!-- Non-obvious behaviours: which statuses are terminal, where failures return to and which states are expressed by quantities rather than their own status. -->

---

## 5. Invariants

| Invariant | Meaning |
| --------- | ------- |
|           |         |

<!-- How invariants are declared and resolved. The rule that only the core enforces them. -->
<!-- Each invariant that spans more than one entity and the way it holds: inside one entity, in one transaction or eventually. ARCHITECTURE.md defines the three. Write "None" if no invariant spans entities. -->

---

## 6. External systems

<!-- Each fact the shell fetches from an external system or another entity before a decision and the command field that carries it. -->
<!-- Each effect that follows an approved decision and the async handler that runs it. -->
<!-- How inbound callbacks from external systems resolve to the <entity> and become commands on the same path as every other write. -->

---

## 7. Contracts with the outside

<!-- Every shape another system depends on: API schemas, published events, shared identifiers and config. How each one changes safely. -->

---

## 8. Checklist for a new feature

<!-- Yes/no questions a feature must pass before merge, one per rule in this document. -->

- [ ]
