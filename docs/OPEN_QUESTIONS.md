# Întrebări deschise

Contradicții, lipsuri și ambiguități găsite în `SRS_Specificarea_Cerintelor_Software.docx` și în
`Dosar_Modele_Vizuale_Cerinte.pdf` în timpul Segmentului 0. Nicio întrebare nu a fost rezolvată
în tăcere: fiecare are o propunere și spune ce face fundația **acum**, ca segmentul care o
întâlnește să știe de unde pornește.

Stări: **Deschisă** (așteaptă decizia autoarei) · **Confirmată** (decisă, păstrată ca istoric).

Cum se închide o întrebare: autoarea decide, se actualizează rândul (stare, decizie, dată), iar
dacă decizia schimbă schema sau contractul, segmentul respectiv face migrarea și `make openapi`.

## Rezumat

| Nr. | Subiect                                                        | Segment | Stare      |
| --- | -------------------------------------------------------------- | ------- | ---------- |
| Q1  | Păstrarea jurnalului APEL_LLM: 12 luni sau 90 de zile          | 7       | Deschisă   |
| Q2  | Starea „Blocat temporar” a contului                            | 1       | Confirmată |
| Q3  | Materialele neverificate: nu se salvează, dar se numără        | 3, 4, 7 | Deschisă   |
| Q4  | CONCEPT ține de materie (SRS) sau de document (Dosar)          | 3       | Confirmată |
| Q5  | Valorile implicite ale preferințelor                           | 1       | Confirmată |
| Q6  | Limita lunară de cost: valoare implicită și monedă             | 7       | Deschisă   |
| Q7  | Dificultatea nu este păstrată pe material                      | 4       | Deschisă   |
| Q8  | Unde se țin întrebările unui test înainte de răspunsuri        | 4       | Deschisă   |
| Q9  | Unicitatea materialelor (C-13) în baza de date                 | 4       | Deschisă   |
| Q10 | Administratorul tratează rapoarte fără să vadă materialul      | 7       | Deschisă   |
| Q11 | Forma exportului CSV                                           | 1       | Confirmată |
| Q12 | Documentele șterse logic: cât se păstrează; ocolirea limitei zilnice | 2 | Deschisă   |
| Q13 | Actualizarea stării documentului în 5 s: interogare periodică  | 2, 6    | Deschisă   |
| Q14 | Generarea materialelor: sincronă sau în fundal                 | 4       | Deschisă   |
| Q15 | Feedback după fiecare răspuns și scor doar la final            | 4       | Deschisă   |
| Q16 | Numărul de pagini pentru DOCX și TXT                           | 2       | Deschisă   |
| Q17 | Unicitatea numelui materiei: cu sau fără majuscule             | 2       | Deschisă   |
| Q18 | „Marchează ca incorect” (RF10) și „Raportează” (RF12)          | 4       | Deschisă   |
| Q19 | Auditul în jurnalul structurat, fără tabel                     | 1, 7    | Confirmată |
| Q20 | Memento-ul „în aplicație” fără entitate proprie                | 8       | Deschisă   |
| Q21 | Crearea contului inițial de administrator                      | 1       | Confirmată |
| Q22 | Deconectarea nu revocă jetonul JWT                             | 1       | Confirmată |
| Q23 | Reîncercarea e-mailurilor: 3 încercări (SRS) sau una (C-01)    | 8       | Deschisă   |
| Q24 | RĂSPUNS nu are legătură directă cu utilizatorul                | 4, 5    | Deschisă   |
| Q25 | Docker Compose nu a fost rulat local                           | 0       | Confirmată |
| Q26 | Versiunea documentelor din `docs/`                             | 0       | Deschisă   |
| Q27 | Cele 15 entități din enunț și cele 16 tabele                   | 0       | Confirmată |
| Q28 | Tipurile de material: patru (RF10) sau cinci (Tabelul 3.21)    | 4       | Confirmată |
| Q29 | `tests.subject_id`                                             | 4       | Confirmată |
| Q30 | Stack: Node.js, nu Python                                      | 0       | Confirmată |
| Q31 | PPTX                                                           | 2       | Confirmată |
| Q32 | Precondiția UC-06 „limita zilnică nu este depășită”            | 4       | Deschisă   |
| Q33 | Limitarea ratei per IP: valori                                 | 1       | Confirmată |
| Q34 | Parola și limita de 72 de octeți a bcrypt                      | 1       | Confirmată |
| Q35 | Blocarea după 5 încercări dezvăluie că e-mailul există         | 1       | Confirmată |
| Q36 | Contul blocat de administrator: ce poate face și ce i se spune | 1, 7    | Confirmată |
| Q37 | Administratorul își blochează sau își șterge propriul cont     | 1, 7    | Confirmată |
| Q38 | Resetarea parolei ridică blocarea temporară                    | 1       | Confirmată |
| Q39 | Mai multe jetoane de resetare valabile simultan                | 1       | Confirmată |
| Q40 | Schimbarea parolei și a e-mailului din cont nu există în SRS   | 1       | Confirmată |
| Q41 | Sesiunea nu se prelungește la activitate                       | 1       | Confirmată |
| Q42 | Acordul GDPR: fără versiune și fără retragere                  | 1       | Deschisă   |
| Q43 | Ștergerea fișierelor la ștergerea contului, înainte de Segmentul 2 | 1, 2 | Amânată (2) |
| Q44 | Cota zilnică de apeluri către model per utilizator             | 3, 4    | Confirmată |

---

## Întrebări deschise

### Q1. Păstrarea jurnalului APEL_LLM: 12 luni sau 90 de zile

- **Contradicție.** SRS 3.4: „Jurnalul APEL_LLM se păstrează 12 luni”. Dosar, C-20: „se păstrează
  90 de zile, apoi se șterge”.
- **Propunere.** 90 de zile: C-20 este formulată ulterior, tocmai ca să clarifice entitatea, și
  respectă mai bine minimizarea datelor (GDPR). Valoarea să fie o setare, nu o constantă.
- **Acum.** Schema nu impune nimic. Sarcina de curățare este a Segmentului 7 și nu există încă.

### Q2. Starea „Blocat temporar” a contului

- **Decizie (16.11.2026).** Propunerea de mai jos (câmpul de decizie a rămas necompletat la Segmentul 1A).

- **Ambiguitate.** SRS: `stare (activ, blocat)` + `blocat până la`. C-17: contul „va avea starea
  «Blocat temporar» timp de 15 minute, apoi va reveni automat la «Activ»; starea este păstrată pe
  cont”.
- **Propunere.** Fără a treia valoare în `status`. „Blocat temporar” înseamnă
  `locked_until > now()`. Este păstrat pe cont, rezistă la repornire și revine automat, fără un
  proces care să rescrie starea. `status = 'blocked'` rămâne doar pentru blocarea de către
  administrator (RF21).
- **Acum.** Așa este schema: `users.status ∈ {active, blocked}`, `failed_login_attempts`,
  `locked_until`. API-ul răspunde `429 ACCOUNT_TEMPORARILY_LOCKED` cu
  `details.retry_after_seconds` (C-12).

### Q3. Materialele neverificate: nu se salvează, dar se numără

- **Contradicție, rezolvată parțial de Dosar.** RF9: elementele neverificate „vor fi marcate
  «Sursă neverificată»” (deci păstrate). C-15 corectează: nu se salvează, se afișează M09 și se
  numără pentru RF23. SRS păstrează totuși câmpul MATERIAL.`sursă verificată (da/nu)`.
- **Problemă rămasă.** Dacă materialele respinse nu se salvează, rata din RF23
  (acceptate / primite) nu are din ce se calcula.
- **Propunere.** Două contoare pe `llm_calls`: `items_received` și `items_accepted`, completate
  la fiecare apel de extragere sau generare. Rata = 1 − Σacceptate / Σprimite. Câmpul
  `materials.source_verified` rămâne (este în SRS), dar pentru un material salvat este mereu
  `true`; constrângerea `status <> 'valid' OR source_verified` impune RB1.
- **Acum.** Contoarele și constrângerea există. `GenerateMaterialsResponse` are
  `rejected_unverified_count`, ca interfața să poată afișa M09.
- **De confirmat.** Dacă `source_verified` trebuie păstrat ca și coloană sau eliminat.

### Q5. Valorile implicite ale preferințelor

- **Decizie (16.11.2026).** Propunerea de mai jos (câmp necompletat la Segmentul 1A).

- **Lipsă.** C-23 spune „cu valorile implicite din RF18”, dar RF18 dă doar intervale.
- **Propunere.** Temă deschisă; mascotă activă; ora 18:00; canal „în aplicație” (niciun e-mail
  fără ca studentul să-l aleagă); obiectiv 20 de recapitulări pe zi.
- **Acum.** Acestea sunt valorile `DEFAULT` din tabelul `preferences`.

### Q6. Limita lunară de cost: valoare implicită și monedă

- **Lipsă.** RF25 cere limita, SRS 2.1.8 enumeră valorile implicite ale celorlalte setări, dar nu
  și pe aceasta. Moneda nu este precizată nicăieri.
- **Propunere.** 10 USD pe lună calendaristică; costul se estimează în USD, moneda în care
  furnizorii publică prețurile.
- **Acum.** `defaultSettings()` scrie `monthly_cost_limit = 10`; contractul descrie câmpurile de
  cost ca USD.

### Q7. Dificultatea nu este păstrată pe material

- **Lipsă.** RF11 configurează testul cu dificultate (ușor, mediu, dificil), iar generarea
  primește dificultatea (Tabelul 3.3), dar entitatea MATERIAL nu are acest câmp. Un test „dificil”
  nu poate alege materialele existente potrivite.
- **Propunere.** Coloană `materials.difficulty` (`easy | medium | hard`, NULL pentru rezumat),
  adăugată printr-o migrare a Segmentului 4.
- **Acum.** Coloana nu există. Contractul acceptă `difficulty` la generare și la test.

### Q8. Unde se țin întrebările unui test înainte de răspunsuri

- **Lipsă.** În ERD, TEST și MATERIAL sunt legate doar prin RĂSPUNS. Până când studentul
  răspunde, nu există nicio înregistrare a întrebărilor alese pentru test, deci testul nu poate
  fi reluat (SRS 3.6.2 cere reluarea).
- **Propunere.** Lista se păstrează în `tests.config`, în câmpul `material_ids` (instantaneu al
  întrebărilor, în ordine). Fără tabel nou.
- **Alternativă.** Rânduri `answers` create dinainte, cu `given_answer` NULL (cere coloană
  opțională).
- **Acum.** `tests.config` este `jsonb` liber; `given_answer` este `NOT NULL`.

### Q9. Unicitatea materialelor (C-13) în baza de date

- **Lipsă.** C-13 interzice salvarea unui material cu „același enunț, după normalizare” pentru
  același concept și tip. Schema nu poate impune asta fără enunțul normalizat.
- **Propunere.** Coloană `statement_hash` (hash al enunțului normalizat) + index unic
  (`concept_id`, `type`, `statement_hash`), într-o migrare a Segmentului 4. Normalizarea să fie
  aceeași funcție ca la verificarea surselor (majuscule, spații).
- **Acum.** Doar index neunic (`concept_id`, `type`). Regula R2 trebuie verificată în serviciu.

### Q10. Administratorul tratează rapoarte fără să vadă materialul

- **Contradicție.** RF24: administratorul vede lista materialelor raportate și poate elimina
  materialul. SRS 3.4: administratorul nu accesează „textul PASAJ, RĂSPUNS sau MATERIAL”.
  Fără text, nu poate judeca dacă raportul este întemeiat.
- **Propunere.** Pentru un material **raportat**, administratorul vede enunțul, răspunsul și
  explicația (nu pasajul și nu documentul). Studentul care raportează își expune voluntar acel
  material; restul rămâne inaccesibil. Cere o modificare a SRS 3.4.
- **Acum.** Contractul respectă litera SRS: `AdminReport` conține motivul, tipul și starea
  materialului, fără text.

### Q11. Forma exportului CSV

- **Decizie (16.11.2026).** Propunerea de mai jos: JSON, respectiv ZIP cu câte un CSV pe set (câmp necompletat la Segmentul 1A). Segmentul 1B justifică dependența pentru ZIP.

- **Ambiguitate.** RF20 cere export „în format JSON și CSV” pentru materii, concepte, rezultate
  și progres. Patru seturi de date nu încap într-un singur fișier CSV.
- **Propunere.** `format=json` → un document JSON. `format=csv` → arhivă ZIP cu câte un CSV
  pentru fiecare set.
- **Acum.** Așa descrie contractul `GET /account/export`. ZIP-ul va cere o dependență în
  Segmentul 1; alternativa fără dependență este câte o cerere pe set (`?format=csv&set=concepts`).

### Q12. Documentele șterse logic: cât se păstrează; ocolirea limitei zilnice

- **Lipsă.** Starea „Șters” este finală, dar nu se spune cât rămâne rândul. Separat: ștergerea
  unei materii șterge fizic și documentele ei, deci un student poate ocoli limita de 10 încărcări
  pe zi ștergând materia.
- **Propunere.** (a) O sarcină a workerului șterge fizic rândurile `deleted` mai vechi de 48 de
  ore (contorul zilnic nu mai are nevoie de ele). (b) Ocolirea prin ștergerea materiei se
  acceptă: costă studentul toată munca din materie.
- **Acum.** Rândurile șterse rămân nelimitat. Ștergerea contului și a materiei le elimină.

### Q13. Actualizarea stării documentului în 5 s: interogare periodică

- **Decizie de proiectare nespecificată.** C-02 cere actualizarea stării afișate în cel mult 5 s,
  fără reîncărcarea paginii.
- **Propunere.** Interogare periodică: cât timp un document este `queued` sau `processing`,
  frontendul cere `GET /documents/{id}` la 2–3 s. Fără WebSocket sau SSE: mai puțin cod, merge
  prin orice proxy, iar 15–50 de utilizatori nu justifică o conexiune permanentă.
- **Acum.** Contractul documentează interogarea periodică. Nu există canal în timp real.

### Q14. Generarea materialelor: sincronă sau în fundal

- **Tensiune.** RNF3 cere un test de 10 întrebări în cel mult 20 s, dar SRS 3.1.3 permite 60 s
  pe apel și două reîncercări, adică până la 180 s într-o singură cerere HTTP.
- **Propunere.** Sincron în versiunea 1 (`POST /materials/generate` răspunde când a terminat),
  cu un buget total de timp impus de serviciu (de exemplu 60 s pentru toate încercările) și
  M07 la depășire. Dacă măsurătorile arată că nu ajunge, generarea trece în worker printr-un ADR
  nou și contractul devine `202` + stare.
- **Acum.** Contractul este sincron (`201` cu materialele).

### Q15. Feedback după fiecare răspuns și scor doar la final

- **Ambiguitate.** UC-07, pasul 5: după fiecare răspuns se afișează răspunsul corect, explicația
  și sursa. C-05: scorul nu se afișează înainte de încheierea ambelor ramuri de evaluare.
  Diagrama de activitate evaluează răspunsurile scurte după trimiterea testului, dar T4 vorbește
  de „evaluarea unui răspuns scurt” în 20 s.
- **Propunere.** După fiecare răspuns: răspunsul corect, explicația, sursa și verdictul, dacă
  este disponibil imediat (grilă, adevărat/fals: da; răspuns scurt: evaluat pe loc, cu
  `unevaluated` dacă modelul nu răspunde). Scorul total și pe concepte doar la `finish`.
- **Acum.** `AnswerFeedback.verdict` poate fi `unevaluated`; `total_score` este NULL până la
  finalizare (impus și de schemă).

### Q16. Numărul de pagini pentru DOCX și TXT

- **Lipsă.** Limita de 100 de pagini și câmpul `pagină` al pasajului presupun pagini. Un fișier
  TXT nu are pagini, iar un DOCX nu are pagini fixe fără redare.
- **Propunere.** Pentru TXT și DOCX, o „pagină” = 3000 de caractere de text curățat; regula se
  documentează în interfață („aproximativ”). PDF folosește paginile reale.
- **Acum.** `page_count` este opțional; `passages.page ≥ 1`. Regula este a Segmentului 2.

### Q17. Unicitatea numelui materiei: cu sau fără majuscule

- **Ambiguitate.** RF3: „unic pentru student”. Nu se spune dacă „Baze de date” și „baze de date”
  sunt același nume.
- **Propunere.** Același nume (comparație fără majuscule și fără spații la capete), ca la
  concepte (RF7).
- **Acum.** Indexul unic este pe (`user_id`, `name`) exact. Schimbarea cere o migrare mică
  (index pe `lower(name)`).

### Q18. „Marchează ca incorect” (RF10) și „Raportează” (RF12)

- **Ambiguitate.** RF10: studentul „va putea marca un material ca incorect”. RF12: studentul
  „va putea raporta o întrebare ca greșită, cu un motiv”. Nu se spune dacă sunt aceeași acțiune.
- **Propunere.** Aceeași acțiune și aceeași entitate (RAPORT_MATERIAL), cu motiv obligatoriu.
- **Acum.** O singură rută: `POST /materials/{id}/reports`.

### Q20. Memento-ul „în aplicație” fără entitate proprie

- **Lipsă.** RF18 permite canalul „în aplicație”, dar nu există o entitate pentru notificări.
- **Propunere.** Fără entitate: `GET /reminders/in-app` calculează pe loc dacă ora aleasă a
  trecut azi și există concepte scadente. Nu există istoric de notificări.
- **Acum.** Ruta este în contract.

### Q21. Crearea contului inițial de administrator

- **Decizie (16.11.2026).** Propunerea de mai jos: comanda `npm run admin:create` (câmp necompletat la Segmentul 1A).

- **Lipsă.** SRS 2.1.8 cere un cont inițial de administrator, fără să spună cum se creează.
- **Propunere.** O comandă a Segmentului 1 (`npm run admin:create -- --email …`), care cere
  parola interactiv; fără valori implicite în cod sau în `.env`.
- **Acum.** Nu există. `make seed` scrie doar setările.

### Q22. Deconectarea nu revocă jetonul JWT

- **Decizie (16.11.2026).** Cale de mijloc, fără coloană nouă (ADR-0011): JWT-ul poartă o
  amprentă a parolei, calculată cu HMAC cu secretul serverului, deci schimbarea parolei
  invalidează toate sesiunile. Deconectarea șterge doar cookie-ul. Utilizatorul este citit din
  bază la fiecare cerere, deci blocarea de către administrator are efect imediat.
- **Risc acceptat.** După deconectare, un JWT furat rămâne valid până la expirare (cel mult 24 h)
  sau până la schimbarea parolei. Opțiune viitoare: coloana `users.session_version`.

- **Limită a soluției.** Cu un JWT fără stare, deconectarea șterge cookie-ul, dar un jeton copiat
  rămâne valid până la expirare (cel mult 24 de ore).
- **Propunere.** Se acceptă: cookie-ul este `HttpOnly`, deci greu de copiat, iar contul este
  verificat în baza de date la fiecare cerere (un cont blocat sau șters pierde accesul imediat).
  Revocarea strictă ar cere un tabel de sesiuni (ADR-0005).
- **Acum.** Doar configurarea există; implementarea este a Segmentului 1.

### Q23. Reîncercarea e-mailurilor: 3 încercări (SRS) sau una (C-01)

- **Contradicție.** SRS 3.1.3: „Trimiterea se încearcă de cel mult 3 ori”. C-01: „va reîncerca o
  singură dată după 5 minute”. C-16 (memento): „va reîncerca o dată după 30 de minute”.
- **Propunere.** Regulile din Dosar, mai precise: link de resetare → o reîncercare după 5 minute;
  memento → o reîncercare după 30 de minute, apoi renunțare pentru ziua respectivă.
- **Acum.** Neimplementat (Segmentul 8). Reîncercarea după minute cere ca starea să fie
  păstrată undeva: propunerea este o sarcină a workerului și `last_reminder_sent_on` pentru
  memento; pentru linkul de resetare, studentul poate cere altul.

### Q24. RĂSPUNS nu are legătură directă cu utilizatorul

- **Observație.** La recapitulare `test_id` este NULL, deci proprietarul răspunsului se află doar
  prin `material → concept → subject → user`. Funcționează, pentru că fiecare material aparține
  unei singure materii a unui singur student, dar interogările de progres (serie de zile,
  evoluție pe 30 de zile) fac patru join-uri.
- **Propunere.** Se păstrează ca în SRS. Dacă măsurătorile T1 o cer, Segmentul 5 adaugă
  `answers.user_id` printr-o migrare.
- **Acum.** Ca în SRS, cu index pe (`material_id`, `answered_at`).

### Q25. Docker Compose nu a fost rulat local

- **Stare de fapt.** Pe mașina de dezvoltare nu este instalat Docker. `infra/docker-compose.yml`
  și Dockerfile-urile au fost verificate doar sintactic. Verificarea reală (`make up`, `/health`,
  cele 16 tabele) se face în jobul `compose` din CI, la primul push.
- **Local s-a verificat** modul fără Docker: PostgreSQL 18 (Postgres.app), `make migrate`,
  `make seed`, `make test`, `make lint`, serverul și proxy-ul frontendului. CI și Compose folosesc
  PostgreSQL 16; migrarea nu folosește nimic specific unei versiuni.
- **Verificat (16.11.2026).** La primul push al ramurii `segment-1a-auth-design`, jobul `compose`
  din CI a trecut: `make up` de la zero, `/health`, proxy-ul frontendului, cele 16 tabele. Tot
  atunci au trecut joburile `backend` și `frontend`. Local, Docker rămâne neinstalat.

### Q26. Versiunea documentelor din `docs/`

- **Stare de fapt.** `docs/` nu exista. SRS a fost copiat din
  `Desktop/Laboratoare2027/ASCS/SRS_… (1).docx` (9 noiembrie), cum s-a indicat. Dosarul nu era în
  `docs/`; a fost găsit și copiat din `Documents/Dosar_Modele_Vizuale_Cerinte.pdf`.
- **De confirmat.** Că acesta este Dosarul de referință. Din el s-au citit integral textul și
  tabelele, plus figurile 3.1 (stări), 3.2 (dialoguri), 5.2 (cazuri de utilizare) și 5.3 (ERD).
  Figurile DFD, swimlane, diagrama de activitate și arborele de funcționalități au fost folosite
  doar prin descrierile lor din text.
- **Notă.** Secțiunea 6.3 a Dosarului (recenzia încrucișată) este necompletată; observațiile
  recenzorului pot aduce cerințe noi.

### Q32. Precondiția UC-06 „limita zilnică nu este depășită”

- **Ambiguitate.** Precondițiile UC-06 (generarea materialelor) includ „Limita zilnică nu este
  depășită”, dar singura limită zilnică definită este cea de încărcări (RF25, P6), care nu are
  legătură cu generarea.
- **Propunere.** Se ignoră pentru generare: nu există o limită de generări pe zi. Costul este
  controlat prin limita lunară (RF25) și prin limitele pe cerere (1–20 concepte, 1–20 materiale).
- **Acum.** Contractul nu are eroare de limită pentru generare.

### Q33. Limitarea ratei per IP: valori

- **Decizie (16.11.2026).** Confirmat: 20 de cereri pe minut per IP pe rutele publice de cont și 3 linkuri
  de resetare pe oră per cont, ambele configurabile. La demonstrație, când mai mulți utilizatori
  vin din aceeași rețea (aceeași adresă IP publică), limita per IP se mărește din configurare
  (`RATE_LIMIT_AUTH_MAX`), fără modificări de cod.

- **Lipsă.** SRS dă o singură limită: 5 încercări eșuate consecutive pentru același e-mail,
  15 minute (RF2). Nu există limite per adresă IP, deși fără ele un atacator poate încerca o
  parolă pe mii de conturi sau poate umple baza cu conturi.
- **Propunere.** Pe rutele publice de cont (înregistrare, autentificare, cerere și confirmare de
  resetare, dezabonare): cel mult 20 de cereri pe minut per IP. Cereri de resetare: cel mult 3 pe
  oră per cont. Toate configurabile.
- **Acum.** `RATE_LIMIT_AUTH_MAX=20`, `RATE_LIMIT_AUTH_WINDOW_SECONDS=60`,
  `PASSWORD_RESET_MAX_PER_HOUR=3`. Contorul este în memoria procesului API (un singur proces în
  pilot); la mai multe procese ar trebui mutat în baza de date.

### Q36. Contul blocat de administrator: ce poate face și ce i se spune

- **Decizie (16.11.2026).** Confirmat, propunerea de mai jos.

- **Lipsă.** RF21 permite blocarea, dar nu spune ce vede studentul blocat.
- **Propunere.** Cu parola corectă primește `403 ACCOUNT_BLOCKED` („Contul este blocat de
  administrator”); cu parola greșită primește M03, ca oricine, deci blocarea nu se află fără
  parolă. Sesiunile existente primesc `403 ACCOUNT_BLOCKED` la următoarea cerere. Nu primește
  link de resetare a parolei (cererea răspunde tot `202`).
- **Acum.** Așa descriu designul și testele din `backend/tests/auth/`.

### Q37. Administratorul își blochează sau își șterge propriul cont

- **Decizie (16.11.2026).** Confirmat. Conturile de administrator se gestionează în afara API-ului;
  procedura este în `docs/design/auth.md`, 6.4.

- **Lipsă.** RF21 nu exclude ca administratorul să se blocheze singur sau să șteargă ultimul cont
  de administrator, ceea ce ar lăsa sistemul fără administrare.
- **Propunere.** Un administrator nu își poate bloca sau șterge propriul cont, iar conturile de
  administrator nu pot fi șterse sau blocate prin API (doar din baza de date). Răspuns: `409 CONFLICT`.
- **Acum.** Așa cer testele serviciului. `POST /account/delete` este oricum doar pentru studenți.

### Q38. Resetarea parolei ridică blocarea temporară

- **Decizie (16.11.2026).** Confirmat, propunerea de mai jos.

- **Lipsă.** RF2 nu spune ce se întâmplă cu blocarea de 15 minute când studentul își resetează
  parola în acest interval.
- **Propunere.** O resetare reușită pune `failed_login_attempts = 0` și `locked_until = NULL`:
  studentul a dovedit că deține căsuța de e-mail. Blocarea de către administrator nu este atinsă.
- **Acum.** Așa cer testele.

### Q39. Mai multe jetoane de resetare valabile simultan

- **Decizie (16.11.2026).** Confirmat, cu condiția: la prima folosire a unui link, toate celelalte
  linkuri active ale contului devin invalide. Verificat de testul „invalidates every other
  outstanding link of the account (Q39)” din `backend/tests/auth/password-reset.test.ts`.

- **Ambiguitate.** Dosar, Tabelul 5.3: „Un student poate cere mai multe resetări; fiecare jeton
  este unic și valabil o oră”. Nu se spune dacă o cerere nouă anulează jetoanele vechi.
- **Propunere.** Jetoanele nefolosite rămân valabile până la expirare (litera Dosarului), dar o
  resetare reușită le anulează pe toate ale contului. Numărul lor este limitat de Q33.
- **Acum.** Așa cer testele.

### Q40. Schimbarea parolei și a e-mailului din cont nu există în SRS

- **Decizie (16.11.2026).** În afara scopului (nu sunt în SRS). Trecute la „Limitări și dezvoltări
  viitoare” în `docs/design/auth.md`, 10.

- **Lipsă.** Singura cale de a schimba parola este resetarea prin e-mail (RF2). Ecranul Setări
  (RF18–RF20) nu are schimbarea parolei și nici a adresei de e-mail.
- **Propunere.** Rămâne așa în versiunea 1. Dacă se adaugă schimbarea parolei din cont, ea cere
  parola curentă și invalidează sesiunile prin același mecanism (ADR-0011).
- **Acum.** Nu există rute pentru ele.

### Q41. Sesiunea nu se prelungește la activitate

- **Decizie (16.11.2026).** Confirmat: sesiune fixă de 24 de ore, conform SRS.

- **Ambiguitate.** RF2: jeton „valabil cel mult 24 de ore”. C-11: la expirare apare ecranul
  „Sesiune expirată”. Nu se spune dacă activitatea prelungește sesiunea.
- **Propunere.** Fără prelungire: sesiunea expiră la 24 de ore de la autentificare, oricâtă
  activitate ar fi. Este citirea literală și cea mai simplă.
- **Acum.** `expires_at` din răspuns este momentul fix al expirării; frontendul îl poate folosi
  ca să anunțe din timp.

### Q42. Acordul GDPR: fără versiune și fără retragere

- **Lipsă.** UTILIZATOR păstrează doar data acordului. Nu există versiunea textului acceptat și
  nici retragerea acordului altfel decât prin ștergerea contului.
- **Propunere.** Suficient pentru pilot: retragerea acordului = ștergerea contului (RF20).
- **Acum.** `gdpr_consent_at` se completează la înregistrare și nu se mai modifică.

### Q43. Ștergerea fișierelor la ștergerea contului, înainte de Segmentul 2

- **Decizie (16.11.2026).** Rămâne pentru Segmentul 2, ca obligație în
  `docs/design/auth-checklist.md`, secțiunea G. Datele deja trimise furnizorului modelului de
  limbaj nu pot fi șterse la ștergerea contului (vezi ADR-0012).

- **Dependență.** RF20 cere ștergerea imediată a datelor, deci și a fișierelor încărcate. Unde și
  cum stau fișierele pe disc decide Segmentul 2.
- **Propunere.** Modulul `auth` nu atinge discul: primește un port `UserFileStore` cu
  `deleteAllForUser(userId)`, apelat după ce tranzacția de ștergere s-a încheiat. Segmentul 2
  furnizează implementarea; până atunci implementarea implicită nu face nimic și avertizează în
  jurnal. Dacă ștergerea fișierelor eșuează, contul rămâne șters, iar eșecul se jurnalizează;
  Segmentul 2 are nevoie de o curățare a fișierelor orfane.
- **Acum.** Portul este definit în `backend/src/modules/auth/types.ts`.

### Q44. Cota zilnică de apeluri către model per utilizator

- **Decizie (16.11.2026).** Cotele se numără în apeluri către model: buget zilnic per proiect de
  80 % din RPD-ul modelului și cotă per utilizator de 60 de apeluri pe zi, ambele configurabile
  (ADR-0012). Abaterea de la SRS 3.1.3 este acceptată: generarea este grupată per tip de
  conținut și validată per concept; detaliile rămân pentru Segmentul 4. Limita de 10 încărcări
  pe zi din SRS rămâne separată.
- **Formulare propusă pentru SRS 3.1.3**, Tabelul 3.3, rândul „Generare materiale (RF10, RF12)”:
  - Intrare: „Lista conceptelor alese (1–20), fiecare cu pasajele sale (id, text); tipul;
    cantitatea pentru fiecare concept (1–20); dificultatea.”
  - Ieșire: „Listă de materiale, fiecare cu identificatorul conceptului: tip, enunț, răspuns,
    explicație, variante (grilă: 4), id pasaj, citat.”
  - Interval, timp: „Timeout 60 s; ieșirea se validează separat pentru fiecare concept:
    materialele invalide ale unui concept se resping fără a le afecta pe ale celorlalte.”
  - După tabel: „Numărul de apeluri către model este limitat zilnic, per utilizator și pe
    întreaga aplicație; limitele sunt configurabile. La atingerea lor, sistemul afișează un mesaj
    care spune când se poate relua generarea.”

- **Lipsă.** SRS limitează doar încărcările (implicit 10 pe zi per student, configurabil 1–50).
  Nu există limită pentru generare, deși UC-06 o presupune (Q32), iar cota gratuită a
  furnizorului este per proiect, nu per utilizator.
- **Propunerea autoarei.** 5 documente noi pe zi per utilizator, configurabil.
- **Estimare (16.11.2026), cu presupuneri.** Un document de curs obișnuit (20–30 de pagini,
  aproximativ 10 concepte), pentru care studentul cere rezumat, flashcard-uri și un test grilă:
  - extragerea conceptelor: 1–3 apeluri (în medie 2);
  - generarea, după interfața din SRS 3.1.3 (un apel primește un concept și pasajele lui):
    10 concepte × 3 tipuri = 30 de apeluri;
  - evaluarea răspunsurilor deschise: câte un apel pe răspuns (0–5);
  - reîncercări la format greșit (cel mult 2 pe apel): aproximativ 10 %.

  Total: aproximativ 35–40 de apeluri pe document. Dacă un apel de generare ar primi toate
  conceptele alese (abatere de la SRS 3.1.3, de decis la Segmentul 4): aproximativ 5–6.
- **Cota gratuită Gemini**, după citiri din AI Studio raportate de terți în septembrie–octombrie
  2026 (nu din documentația oficială; de verificat pe proiectul propriu): Flash 5 cereri pe
  minut și 20 pe zi; Flash-Lite 15 pe minut, 500 pe zi, 250 000 de jetoane pe minut.
- **Concluzie.** 5 documente pe zi înseamnă 175–200 de apeluri pe zi per utilizator. Pe
  Flash-Lite încap 2 utilizatori activi la maximum pe zi (cu gruparea conceptelor: aproximativ
  16). Pe Flash nu încape nici un singur document. Limita de 15 cereri pe minut face ca un
  document să dureze cel puțin 2–3 minute și cere o coadă cu ritm controlat.
- **Propunere.** (1) Cota per utilizator se numără în apeluri către model, nu în documente,
  fiindcă generarea se face la cerere și un document poate consuma oricât. (2) Pe lângă ea, un
  buget zilnic per proiect, sub cota furnizorului, cu mesaj clar la epuizare. (3) Ambele în
  CONFIGURARE. (4) Limita de încărcări din SRS rămâne separată.
- **Acum.** Nimic implementat; se decide înainte de Segmentele 3 și 4.

---

## Confirmate (istoric)

### Q34. Parola și limita de 72 de octeți a bcrypt

- RNF6 impune bcrypt, care ignoră tot ce depășește 72 de octeți. RF1 permite 64 de caractere, iar
  64 de litere cu diacritice înseamnă până la 128 de octeți: două parole diferite ar deveni egale.
- **Decizie (16.11.2026).** O parolă de peste 72 de octeți în UTF-8 este respinsă cu
  `PASSWORD_TOO_LONG` (variantă a mesajului M01), cu un mesaj care spune limita explicit.

### Q35. Blocarea după 5 încercări dezvăluie că e-mailul există

- După a 5-a încercare greșită, un cont existent răspunde `429 ACCOUNT_TEMPORARILY_LOCKED`, iar
  o adresă fără cont răspunde în continuare `401`. Diferența arată că adresa are cont.
- **Decizie (16.11.2026).** Excepție acceptată de la anti-enumerare, fiindcă RF2, M03 și C-12 cer
  explicit blocarea și afișarea timpului rămas. Este atenuată de limita per IP (Q33). A doua
  excepție cerută de SRS este M02 la înregistrare.

### Q4. CONCEPT ține de materie (SRS) sau de document (Dosar)

- SRS: CONCEPT are `materie`. Dosar: CONCEPT are `document_id` (N:1), iar C-22 permite unirea
  doar în același document. RF7 limitează la 100 de concepte „pentru un document”.
- **Decizie (12.11.2026).** Rămâne `concepts.subject_id`; documentul se deduce prin
  `concept_passages → passages.document_id`. Fără coloană nouă.
- **Consecință de reținut.** Schema permite, tehnic, un concept cu pasaje din două documente.
  Serviciul din Segmentul 3 trebuie să o împiedice (la creare, la unire) și să aibă test.
  API-ul expune `Concept.document_id` ca valoare derivată.

### Q19. Auditul în jurnalul structurat, fără tabel

- SRS 2.4 și 3.5.1 cer consemnarea ștergerii conturilor și a modificărilor de configurare „cu
  data, autorul și rezultatul”; SRS 3.6.3 cere jurnale pentru autentificări eșuate și acțiuni ale
  administratorului. Nicio entitate nu le poate reține.
- **Decizie (12.11.2026).** Evenimente în jurnalul structurat, prin `auditLog()`
  (`backend/src/core/logger.ts`), fără tabel nou. `preferences.last_reminder_sent_on` și
  `concept_progress.celebrated` acoperă celelalte două lipsuri.
- **De reținut.** Păstrarea jurnalului depinde de locul în care rulează aplicația; nu există
  interfață de consultare.

### Q27. Cele 15 entități din enunț și cele 16 tabele

- **Decizie (12.11.2026).** Baza este SRS (15 entități) + TOKEN_RESETARE = 16 tabele. ERD-ul din
  Dosar are tot 15, pentru că unește PROGRES_CONCEPT și RECAPITULARE în STĂPÂNIRE.
  Corespondența este în DATA_MODEL.md, secțiunea 3.

### Q28. Tipurile de material: patru (RF10) sau cinci (Tabelul 3.21)

- **Decizie (12.11.2026).** Cinci valori: `summary`, `flashcard`, `multiple_choice`, `open`,
  `true_false`. „Răspuns scurt” (RF11) = `open`. Studentul poate cere patru tipuri (RF10);
  `true_false` apare doar în teste.

### Q29. `tests.subject_id`

- **Decizie (12.11.2026).** Coloană adăugată, ca ștergerea materiei să șteargă testele (RF3).

### Q30. Stack: Node.js, nu Python

- **Decizie (12.11.2026).** Node.js + TypeScript, conform SRS 2.4. Fastify, Drizzle, Zod, Vitest
  (ADR-0001, ADR-0002). Nu există abatere de la SRS.

### Q31. PPTX

- **Decizie (12.11.2026).** În afara contractului: SRS acceptă doar PDF, DOCX, TXT. Extractorul
  PPTX rămâne în `legacy/express/` și nu se portează.
