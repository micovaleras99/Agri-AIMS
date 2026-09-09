-- One vocabulary for "Classification of LSA", stored one way.
--
-- The two tables disagreed about what a classification even is:
--
--   applicants.classification   held keys    'organic', 'gahp_animals'
--   farms.classification        held labels  'Organic Agriculture', 'GAHP - Fishery'
--
-- Same column name, same concept from the Guidelines, two incompatible
-- formats. Any code touching both had to know which was which, and the filter
-- on Farms could never be built from the same list the applicant form offers.
--
-- Keys win, for two reasons. The applicant form already writes them, and that
-- is the live path: farms are never created by the application — the only
-- INSERT INTO farms is the one-time seed script — so the labels sitting in
-- farms are seed data, not something the system produces. And a key survives
-- the wording changing, which it just did: the Guidelines say "Good
-- Agricultural Practice (GAP)", not "GAP - Crops".
--
-- Each farm is resolved through its applicant rather than by matching the
-- label text. Every farm has an applicant_id, and the applicant already holds
-- the key, so this carries no guesswork — including for 'GAHP - Fishery',
-- which is not a classification the Guidelines list at all but whose applicant
-- says 'gahp_animals'.

UPDATE farms f
  JOIN applicants a ON a.id = f.applicant_id
   SET f.classification = a.classification
 WHERE a.classification IS NOT NULL
   AND a.classification <> ''
   AND f.classification <> a.classification;

-- Any farm without a usable applicant link falls back to matching the label.
-- Wording that no longer appears on the form is included, because the point is
-- to leave nothing behind in the old format.
UPDATE farms
   SET classification = CASE LOWER(TRIM(classification))
     WHEN 'gap - crops'                              THEN 'gap_crops'
     WHEN 'gahp - animals'                           THEN 'gahp_animals'
     WHEN 'gahp - fishery'                           THEN 'gahp_animals'
     WHEN 'natural farming'                          THEN 'natural_farming'
     WHEN 'organic agriculture'                      THEN 'organic'
     WHEN 'organic agriculture (certified)'          THEN 'organic'
     WHEN 'integrated farming'                       THEN 'integrated'
     WHEN 'integrated/diversified farming'           THEN 'integrated'
     WHEN 'cut flowers & ornamentals'                THEN 'cut_flowers'
     WHEN 'cut flowers, ornamentals, and succulents' THEN 'cut_flowers'
     WHEN 'halal'                                    THEN 'halal'
     WHEN 'urban/peri-urban agriculture'             THEN 'urban_agriculture'
     WHEN 'urban and peri-urban agriculture'         THEN 'urban_agriculture'
     WHEN 'agri-processing enterprise'               THEN 'agri_processing'
     ELSE classification
   END
 WHERE classification IS NOT NULL
   AND classification <> ''
   AND classification COLLATE utf8mb4_general_ci IN (
     'GAP - Crops', 'GAHP - Animals', 'GAHP - Fishery', 'Natural Farming',
     'Organic Agriculture', 'Organic Agriculture (Certified)', 'Integrated Farming',
     'Integrated/Diversified Farming', 'Cut Flowers & Ornamentals',
     'Cut Flowers, Ornamentals, and Succulents', 'Halal',
     'Urban/Peri-Urban Agriculture', 'Urban and Peri-Urban Agriculture',
     'Agri-Processing Enterprise'
   );
