# ADR-0012 — Furnizorul LLM: Google Gemini API, plan gratuit

Stare: Acceptat · Data: 2026-11-16 · Se aplică în Segmentele 3 și 4; nimic din el nu este încă implementat

## Decizie

Generarea (rezumate, teste grilă, flashcard-uri) folosește Gemini API pe planul gratuit (Google
AI Studio), printr-o interfață care permite schimbarea furnizorului și a modelului din
configurare.

## Constrângeri

1. Cotă comună și mică. Limitele (RPM, TPM, RPD) se aplică per proiect Google, nu per cheie și nu
   per utilizator. Ordinul de mărime raportat (de verificat în AI Studio pe proiectul real):
   Flash ~20 cereri/zi, Flash-Lite ~500 cereri/zi, ~15 cereri/min. Valorile nu se scriu în cod;
   modelul și limitele vin din configurare.
2. Eroarea 429 (RESOURCE_EXHAUSTED) este un caz normal: reîncercare cu backoff exponențial și
   jitter, număr limitat de reîncercări, apoi cod LLM_QUOTA_EXHAUSTED și mesaj clar pentru
   utilizator.
3. Date. Pe planul gratuit Google folosește prompturile și răspunsurile pentru îmbunătățirea
   produselor, iar evaluatori umani le pot citi. Prin urmare:
   - către LLM se trimite DOAR textul fragmentelor din document; niciodată e-mail, nume, ID de
     utilizator sau alte date de cont;
   - utilizatorul este informat la încărcare (UI + politica de confidențialitate) că documentul
     este procesat de un serviciu extern;
   - la ștergerea contului, datele deja trimise către Google nu pot fi șterse; se documentează.
4. Termeni Gemini: vârsta minimă 18 ani; pentru utilizatori din SEE/UK/Elveția este permis doar
   planul plătit. Aplicația vizează studenți din Republica Moldova; extinderea în aceste regiuni
   impune planul plătit.

## Cerințe de arhitectură

- Interfața `LLMClient` (ADR-0009), cu o implementare pentru Gemini; furnizor, model și cheie din
  configurare. `FakeLLMClient` pentru teste și dezvoltare: testele nu apelează niciodată API-ul
  real.
- Cheia API doar pe server (variabilă de mediu).
- Generarea rulează asincron în worker, printr-o coadă cu limitator global (token bucket) care
  respectă RPM-ul configurat.
- Economie de apeluri: conceptele se grupează într-un singur apel per tip de conținut, cu ieșire
  JSON structurată, validată per concept (ținta: 5–6 apeluri per document). Toată generarea se
  face la cererea studentului, conform RF10; nimic nu se generează la încărcare.
- Cache: un rezultat se generează o singură dată per (document, tip, versiune prompt) și se
  salvează în bază.
- Cote numărate în apeluri către model: buget zilnic per proiect (implicit 80% din RPD-ul
  modelului, restul rezervă pentru reîncercări) și cotă zilnică per utilizator. Ambele
  configurabile.
- Rezervă: la cotă epuizată sau API indisponibil se oferă metoda clasică de generare, cu sursa
  indicată clar în interfață.
- Contorizare: cereri și tokeni per zi, pentru monitorizare și pentru capitolul de evaluare din
  lucrare.

## Consecințe

Cost zero, suficient pentru prototip și demonstrație. Gruparea conceptelor impune modificarea SRS
3.1.3 (vezi Q44). Limitele concrete se consemnează în lucrare cu data consultării. Pentru
susținere, conținutul demonstrației se pregenerează (cache).

## Legături

Interfața, metodele ei și clientul fals sunt descrise în [ADR-0009](0009-llmclient.md). Gruparea
conceptelor schimbă semnătura `generateMaterials` de acolo (azi: un concept pe apel); Segmentul 4
o modifică împreună cu SRS 3.1.3.
