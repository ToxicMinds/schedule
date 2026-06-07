# GitHub Secrets Setup

Run these commands from anywhere with `gh` authenticated:
(then `gh auth login` if needed)

```bash
gh secret set PUBLIC_SUPABASE_URL \
  --repo ToxicMinds/schedule \
  --body "https://todakddcgsktsvkmvhzk.supabase.co"

gh secret set PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --repo ToxicMinds/schedule \
  --body "sb_publishable_H4NXqDDnGdHaWTlsORyCtw_5AKOVJFD"
```

Or manually in GitHub UI:  
`https://github.com/ToxicMinds/schedule/settings/secrets/actions`
