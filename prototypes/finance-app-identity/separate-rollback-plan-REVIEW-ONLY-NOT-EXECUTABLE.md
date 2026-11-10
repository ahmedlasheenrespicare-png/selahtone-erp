# خطة الرجوع المنفصلة — للمراجعة فقط — مسار فحص الهوية داخل الخدمة

**ROLLBACK PLAN · FOR REVIEW ONLY · NOT EXECUTABLE · NOT AN EXECUTION APPROVAL · TEST ONLY**

- **التاريخ:** 2026-11-05
- **السند:** تكليف **منفصل صريح** بإعداد خطة الرجوع المنفصلة بعد الموافقة الحرفية §٩٤؛ `ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL` مستوفى.
- **النص الذي تخصّه:** `in-service-identity-probe-REVIEWED-TEXT-NOT-EXECUTABLE.md` بالبصمة `629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e`.
- **بصمة الخطة (SHA-256):** `3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c`
- **الحالة:** `ROLLBACK_PLAN_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED` · `blockers_resolved=0` · `gates_opened=0` · `NOT_READY`.

## ١. ما هذا النص
خطة رجوع **وصفية** مُثبَّتة ببصمتها ومعايير قبولها، تُعدّ للمراجعة فقط عقب الموافقة الحرفية المنفصلة على النص المُراجَع. ليست SQL تنفيذيًا، وليست كودًا، ولا تُطبَّق في `src` الآن، ولا تُجمَّع مع أي موافقة. إعدادها ليس موافقة على المسار داخل الخدمة ولا إجازة نشر ولا إجازة ضبط متغير.

## ٢. الخطة المُثبَّتة (للمراجعة فقط)

```text
SEPARATE_ROLLBACK_PLAN v1.0 / REVIEW ONLY / NOT EXECUTABLE / TEST ONLY
FOR: IN_SERVICE_IDENTITY_PROBE_SPEC v1.0, pinned SHA 629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e

STATUS
Prepared for operator review only, after the separate verbatim approval of
the reviewed text. Preparation is not an approval, not a rehearsal, and not
an execution authorization. Ownership of every action stays with the operator.

TRIGGERS TO REVERT (any one is enough)
T1 A connection error, a wrong pooled value, or any failure of the service
   to start with its own runtime configuration after the diagnostic path.
T2 The observed identity is not selahtone_app, or privileged built-in roles
   or inherited write-all-data roles are present in the observation.
T3 Any unexpected write, any non-read-only transaction, or any data row in
   the diagnostic output.
T4 A missing year in the timestamp, a missing deployment identifier, or any
   secret or connection value appearing in an output or in the chat.
T5 Any evidence gap about the deployed process, or any request to widen the
   scope beyond a read-only identity observation.

REVERT SEQUENCE (descriptive only; no command is issued here)
R1 Stop using the new diagnostic path and keep the finance flag disabled;
   this plan never re-enables finance at any point.
R2 Restore the previously configured pooled connection value by the operator,
   using the stored old pooled value only; never print or transmit its
   contents. No new password, no credential rotation, no role removal.
R3 Restore the previously running release candidate of the service by the
   operator, together with the exact source revision that produced it. Any
   source change made for the diagnostic path is reverted with it. The
   blueprint file and environment declarations are not edited here.
R4 Keep all database objects exactly as they are: no data migration, no
   schema change, no privilege change, no trigger or policy change, and no
   deletion of either selahtone_app or selahtone_finance_admin.
R5 Verify by read-only observation only: the finance interface stays
   disabled, the two guarded pages keep their documented behaviour, no cash
   movement or collection-custody link is written, and no financial action
   is attempted during the revert.
R6 Record the revert with its UTC timestamp including the year, the decision
   owner, and the reason, then hand the record to offline evaluation. A revert
   is a state restoration, not a proof of the deployed application identity.

ACCEPTANCE CRITERIA (six)
B1 The plan names the pinned reviewed-text SHA it belongs to and no other.
B2 Every trigger and every revert step is descriptive; zero executable
   statements, zero source edits, zero environment edits, zero secrets.
B3 Reverting the pooled value uses the stored old pooled value only, and a
   connection error causes an immediate revert to that value.
B4 The finance flag stays disabled throughout this plan; no separate
   re-enable decision is solicited or implied.
B5 No data row, no password, no connection value, and no financial action
   appears in any output, in any record, or in the chat.
B6 Preparing this plan resolves no blocker and opens no gate; its own
   separate verbatim approval, the separate in-service path approval, and
   separate source and deploy approvals (if needed) all still lie ahead.

OUT OF SCOPE
Producing executable statements, running a probe, rehearsing the revert,
editing source files or the blueprint, deploying, syncing the blueprint,
changing environment values, rotating credentials, removing roles, any
financial action, and the separate re-enable decision.

BOUNDARIES
NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE
NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION
SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS
EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION
This plan is NOT executable SQL, NOT an execution approval, and NOT a gate.
```

## ٣. الحدود
`NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE` · `SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS` · `EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION`. تبقى الموافقة الحرفية المنفصلة على هذه الخطة وحدها، ثم موافقة المسار داخل الخدمة، ثم موافقا `src` والنشر إن لزما، كلها خطوات منفصلة لم تصل. «تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.»
