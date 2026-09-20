# AVC Constraint Discovery

Two-step BAPI sequence for discovering constraints under AVC CNETs (type 16):

1. **`CARD_CONSTRAINT_NET_READ`** — lists all constraint nets for a profile
2. **`CARD_CNET_CONSTRAINT_READ`** — gets source code for each constraint within a net

AVC uses numeric dependency types instead of LO-VC text values:
- Type `16` = CNET (constraint net) — equivalent to `'CNET'`
- Type `17` = Procedure — equivalent to `'PROC'`
- Type `11` = Constraint

These come from `CARD_CON_PROFILE_READ`'s `CON_PRO_DEPENDENCY_DATA.DEP_TYPE`.

## AVC Constraint Source I/O

OBJECTS/RESTRICTIONS syntax uses `Alias.Characteristic` notation. Added `reAlias` regex in `showDepSource()`.

Raw JSON save keys must use lowercase (`result.profile`, NOT `result.Profile`).
