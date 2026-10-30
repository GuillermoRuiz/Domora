-- Retain the identifier, but do not reorder NotificationCategory. The app uses
-- category equality and explicit presentation order, never enum comparisons.
-- Validate membership only; preserve the type OID, data and ALL dependencies.
BEGIN;

DO $$
DECLARE
  current_labels text[];
  expected_labels constant text[] := ARRAY[
    'adhesion', 'onboarding', 'issue', 'direct_message', 'inspection',
    'meeting', 'communication', 'ticket', 'booking', 'receipt', 'billing', 'task'
  ];
BEGIN
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
  INTO current_labels
  FROM pg_enum e WHERE e.enumtypid = 'public."NotificationCategory"'::regtype;

  IF NOT (current_labels @> expected_labels AND expected_labels @> current_labels)
     OR cardinality(current_labels) <> cardinality(expected_labels) THEN
    RAISE EXCEPTION 'Unexpected NotificationCategory labels; manual review required';
  END IF;
END $$;

COMMIT;
