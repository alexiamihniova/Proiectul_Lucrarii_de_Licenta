# ADR-0009: Interfața LLMClient

Stare: Acceptat · Data: 2026-11-12 · Implementarea reală aparține Segmentului 3

## Context

SRS 3.5 impune un singur model de limbaj, apelat doar de pe server, iar ipoteza A5 cere ca
modelul să poată fi înlocuit fără schimbarea cerințelor. SRS 3.1.3 definește trei operații cu
intrări, ieșiri și limite de timp. Reîncercările, jurnalul apelurilor și verificarea surselor au
reguli proprii (C-06, C-14, RF9).

## Decizie

- O interfață `LLMClient` cu **trei metode**, câte una pentru fiecare operație din Tabelul 3.3:
  `extractConcepts`, `generateMaterials`, `evaluateAnswer`. Intrările și ieșirile sunt scheme Zod.
- **Un apel de metodă = o cerere către furnizor.** Clientul nu reîncearcă, nu scrie în baza de
  date, nu verifică surse. Reușește doar cu o ieșire care respectă schema; orice eșec este un
  `LLMError` cu `kind`: `timeout`, `invalid_response`, `rate_limited`, `unavailable`.
- Schemele de ieșire verifică doar **formatul** (condiția C1 din tabelul de decizie). Existența
  pasajului și regăsirea citatului (C2, C3) se verifică în modulul `analysis`.
- Furnizorul se alege din configurare (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`) prin
  `createLlmClient(config)`.
- `FakeLLMClient`: determinist, fără rețea, cu răspunsuri și erori programabile; este și
  furnizorul implicit în dezvoltare (`LLM_PROVIDER=fake`), interzis în producție.

## Alternative respinse

- **O singură metodă generică** (`complete(prompt): string`). Fiecare apelant ar fi construit
  prompturi și ar fi interpretat JSON pe cont propriu; formatul din SRS nu ar fi avut un loc unic.
- **Reîncercări și jurnal în interiorul clientului**. Fiecare implementare de furnizor le-ar fi
  rescris, iar clientul fals nu le-ar fi exercitat. Puse într-un serviciu deasupra interfeței,
  se scriu o dată și se testează cu clientul fals.
- **Un cadru de orchestrare (de tip LangChain)**. Dependență mare pentru trei apeluri cu format
  fix.
- **SDK-ul unui furnizor folosit direct în module**. Schimbarea modelului ar fi atins toate
  modulele; ar fi contrazis A5.

## Consecințe

- Segmentul 3 adaugă: clientul real (un `case` în `createLlmClient`), serviciul cu reîncercări
  (cel mult 3 încercări în total), o linie în `llm_calls` pentru fiecare încercare și maparea la
  `LLM_UNAVAILABLE` (M07).
- Segmentele 3 și 4 își pot testa toate ramurile regulii R1–R5 cu `FakeLLMClient.enqueue(...)`.
- Costul estimat este calculat de implementarea reală, din jetoanele raportate de furnizor.
