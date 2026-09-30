-- Display-only rename, matching the ChurchOnPoint rebrand: "VPD
-- Academy" -> "COP Academy" wherever shown to users. The internal
-- feature key stays 'vpd_academy' (same pattern as 'ecodem' staying
-- the internal department key while its label became "Sunday School")
-- -- nothing else references this by name, so no other code changes.

update public.features set name = 'COP Academy (online courses)' where key = 'vpd_academy';
