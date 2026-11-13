-- A website's own search box and language, found when the site is read:
-- search_template: its search address with {q} where the words go (null: none found);
-- lang: the language the site says it's written in ("it"), so questions in another
-- language can be turned into the words its pages use.
alter table public.business_sites add column search_template text check (search_template is null or char_length(search_template) <= 500);
alter table public.business_sites add column lang text check (lang is null or char_length(lang) <= 10);
