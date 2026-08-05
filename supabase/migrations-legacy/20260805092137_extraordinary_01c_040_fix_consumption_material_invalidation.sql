begin;

create extension if not exists http with schema extensions;

do $runner$
declare
  v_status integer;
  v_content text;
  v_body text;
  v_blob_sha text;
  v_prefix constant text := E'\\set ON_ERROR_STOP on\n\nbegin;\n\n';
begin
  select response.status, response.content
  into v_status, v_content
  from extensions.http_get(
    'https://raw.githubusercontent.com/ramon1415/catalogo-proveedores-flux/7badf34b10cc7173bd40e9904a8c642007bd86ea/supabase/migrations/20260805090003_040_fix_extraordinary_consumption_and_material_invalidation.sql'
  ) response;

  if v_status <> 200 or v_content is null then
    raise exception '040_remote_source_unavailable: status %', v_status;
  end if;

  v_blob_sha := encode(
    digest(
      convert_to(
        'blob ' || octet_length(convert_to(v_content, 'UTF8'))::text,
        'UTF8'
      )
      || decode('00', 'hex')
      || convert_to(v_content, 'UTF8'),
      'sha1'
    ),
    'hex'
  );

  if octet_length(convert_to(v_content, 'UTF8')) <> 77757
     or v_blob_sha <> '2470aea5a2d65827b2f360f5bf040cd16cdec913' then
    raise exception
      '040_remote_source_identity_mismatch: bytes %, blob %',
      octet_length(convert_to(v_content, 'UTF8')),
      v_blob_sha;
  end if;

  if left(v_content, char_length(v_prefix)) <> v_prefix then
    raise exception '040_remote_source_prefix_unexpected';
  end if;

  v_body := substring(v_content from char_length(v_prefix) + 1);
  v_body := regexp_replace(v_body, E'\ncommit;[[:space:]]*$', '');

  if v_body = v_content
     or position(E'\\set ' in v_body) > 0
     or left(v_body, 4) <> 'set '
     or right(regexp_replace(v_body, '[[:space:]]+$', ''), 1) <> ';' then
    raise exception '040_remote_source_wrapper_removal_failed';
  end if;

  execute v_body;
end
$runner$;

drop extension http;

commit;
