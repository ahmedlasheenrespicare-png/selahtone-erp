-- Synthetic-only session fixtures. Populate current and subsequently created
-- users so every actor(id) has a matching, independently revocable session.
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id varchar(64) PRIMARY KEY,
  user_id bigint NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE OR REPLACE FUNCTION public.add_synthetic_commerce_session() RETURNS trigger
LANGUAGE plpgsql AS $body$
BEGIN
  INSERT INTO public.auth_sessions(id,user_id,expires_at)
  VALUES('synthetic-commerce-session-' || NEW.id,NEW.id,clock_timestamp()+interval '1 day')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS synthetic_commerce_session ON public.users;
CREATE TRIGGER synthetic_commerce_session AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.add_synthetic_commerce_session();
INSERT INTO public.auth_sessions(id,user_id,expires_at)
SELECT 'synthetic-commerce-session-' || id, id, clock_timestamp() + interval '1 day'
FROM public.users
ON CONFLICT (id) DO NOTHING;
