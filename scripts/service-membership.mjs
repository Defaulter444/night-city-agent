const norm=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
/** Exact configured names and bounded provider tokens avoid e.g. Oreo memberships. */
export function membershipNameMatches(name,service,exactNames='') {
  if(!['trauma','reo'].includes(service))return false;
  const value=norm(name), exact=String(exactNames).split(/\r?\n|;/).map(norm).filter(Boolean);
  if(exact.includes(value))return true;
  const provider=service==='trauma'
    ? /(?:^|[^\p{L}\p{N}])(?:trauma\s+team|тра(?:в|у)ма[\s-]+тим)(?=$|[^\p{L}\p{N}])/u
    : /(?:^|[^\p{L}\p{N}])(?:r\.?e\.?o\.?|р\.?е\.?о\.?|мясовоз[\p{L}]*)(?=$|[^\p{L}\p{N}])/u;
  const policy=/(?:^|[^\p{L}])(?:membership|подписк[\p{L}]*|членств[\p{L}]*|полис)(?=$|[^\p{L}])/u;
  return provider.test(value)&&policy.test(value);
}
