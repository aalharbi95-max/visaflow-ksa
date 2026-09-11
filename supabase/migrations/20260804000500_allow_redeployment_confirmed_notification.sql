begin;

do $migration$
declare
  function_signature constant text := 'public.notification_event_mutate_legacy_20260802(text,bigint,jsonb)';
  existing_definition text;
  updated_definition text;
begin
  if to_regprocedure(function_signature) is null then
    raise exception 'notification_event_mutate_legacy_20260802 is required before enabling redeployment confirmations';
  end if;

  existing_definition := pg_get_functiondef(to_regprocedure(function_signature));

  if position($needle$'REDEPLOYMENT_CONFIRMED'$needle$ in existing_definition) > 0 then
    return;
  end if;

  if position($needle$'WORKFORCE_REDEPLOYMENT_REVIEW','AGENCY_PENALTY_SENT'$needle$ in existing_definition) = 0 then
    raise exception 'Expected notification allowlist marker was not found';
  end if;

  updated_definition := replace(
    existing_definition,
    $needle$'WORKFORCE_REDEPLOYMENT_REVIEW','AGENCY_PENALTY_SENT'$needle$,
    $replacement$'WORKFORCE_REDEPLOYMENT_REVIEW','REDEPLOYMENT_CONFIRMED','AGENCY_PENALTY_SENT'$replacement$
  );

  if updated_definition = existing_definition then
    raise exception 'Redeployment notification allowlist was not updated';
  end if;

  execute updated_definition;
end
$migration$;

commit;
