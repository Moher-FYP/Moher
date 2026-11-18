# api/data

`common-passwords-12plus.txt.gz`: the 46,146 passwords of 12 or more characters from
`xato-net-10-million-passwords-1000000.txt` in [SecLists](https://github.com/danielmiessler/SecLists)
(MIT licence, © 2018 Daniel Miessler), lower-cased and de-duplicated. The portal refuses a new
password on this list (`src/portal/passwords.ts`). Shorter entries are left out because the
portal's 12-character minimum refuses them anyway.

Rebuilt with:

```bash
curl -sSfL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt \
  | awk 'length($0)>=12' | tr 'A-Z' 'a-z' | sort -u | gzip -9 > common-passwords-12plus.txt.gz
```
