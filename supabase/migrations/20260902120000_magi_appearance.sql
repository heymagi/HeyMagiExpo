/*
  How MAGI looks and what she is called.

  Lives on the profile rather than only on the device so it follows her to a new phone, and
  so MAGI can offer to change it -- an offer she cannot make about a value she cannot read.
  The device keeps its own copy in AsyncStorage regardless: appearance must survive being
  offline, and a sync failure must never be able to take her character away from someone.

  jsonb rather than three columns because this is one settable thing that will grow -- a
  voice, a motion preference for her specifically -- and because the client already treats
  it as one object. The CHECK constrains the two enumerated fields without pinning the shape.

  No new RLS policy: profile already carries `FOR ALL TO authenticated USING (account_id =
  auth.uid())`, so a column added to it inherits exactly the right access.

  NOTE: already applied to the live project (ozyxbdefhwoejejgyshm). Reproduced here because
  the original file was lost with the working directory.
*/
ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS magi_appearance jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profile.magi_appearance IS
  'MAGI''s appearance as the user set it: {form, palette, name}. Empty object means defaults. Mirrored on the device so it works offline.';

ALTER TABLE profile DROP CONSTRAINT IF EXISTS profile_magi_appearance_shape;
ALTER TABLE profile ADD CONSTRAINT profile_magi_appearance_shape CHECK (
  jsonb_typeof(magi_appearance) = 'object'
  AND (NOT magi_appearance ? 'form'
       OR magi_appearance->>'form' IN ('aura', 'bloom', 'friend'))
  AND (NOT magi_appearance ? 'palette'
       OR magi_appearance->>'palette' IN ('sunset', 'meadow', 'berry', 'citrus', 'calm', 'single'))
  AND (NOT magi_appearance ? 'name'
       OR (jsonb_typeof(magi_appearance->'name') = 'string'
           AND length(magi_appearance->>'name') <= 24))
);
