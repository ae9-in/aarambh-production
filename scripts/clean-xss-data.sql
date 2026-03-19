-- Run this immediately in Supabase SQL editor.
UPDATE enquiries SET 
  name = regexp_replace(regexp_replace(name, '<[^>]*>', '', 'g'), 
    '(javascript:|data:|vbscript:)', '', 'gi'),
  message = regexp_replace(regexp_replace(COALESCE(message,''), 
    '<[^>]*>', '', 'g'), '(javascript:|data:|vbscript:)', '', 'gi')
WHERE name LIKE '%<%' OR name LIKE '%javascript%' 
  OR message LIKE '%<%' OR message LIKE '%javascript%'
  OR name LIKE '%script%' OR message LIKE '%script%';

DELETE FROM enquiries WHERE 
  name LIKE '%onerror%' OR name LIKE '%onload%' 
  OR name LIKE '%fetch(%' OR name LIKE '%document.cookie%'
  OR message LIKE '%169.254%' OR message LIKE '%etc/passwd%';

