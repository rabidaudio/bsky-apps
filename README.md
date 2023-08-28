# BSky Apps

This app will be the container for all my BlueSky-related development. Running at `bsky.rabid.audio`. Currently there's only one thing implemented:

## Custom list feeds

Sometimes you want to see only posts from certain people, for example a group of close friends
or an organization. Eventually Bluesky will likely add support for feeds based on lists, but
currently lists are only used for mutes.

In the meantime, this app allows you to create your own feeds based on a list of users you create on this app.
This app allows you to create lists that are unique to you. It works like this:

1. You log in to this site using a BSky [App Password](https://bsky.app/settings/app-passwords) (**don't give me your account password, that would be unwise**)
2. Create your list(s) here on this site. Lists can be public or private. If other users try to add your private list to their timeline, it will be empty and they will be unable to see who is on it. However, **the list name is public and will appear on your profile (on the web anyway) under the "Feeds" section.**
3. Go to your profile (currently only supported on the web) and you should see a new "Feeds" section, where you can subscribe to these feeds.

The UI is still being built, but the API is live, you can test it out yourself:

```bash
# Create a list
curl -vv -X POST -H 'Content-Type: application/json' -d '{
    "identifier": "yourhandle.bsky.social",
    "password": "app-password",
    "name": "My Cool List",
    "isPublic": false,
    "memberHandles": ["rabid.audio", "jay.bsky.team", "stovey.queerhou.se"]
}' "https://bsky.rabid.audio/api/lists"

# Delete a list (you'll need the id, which is the 15 hexadecimal chars at the end of the url)
curl -vv -X DELETE -H 'Content-Type: application/json' -d '{
    "identifier" :"yourhandle.bsky.social",
    "password": "app-password"
}' "https://bsky.rabid.audio/api/lists/deadbeef0123456"
```

### Current Limitations

This is a pretty quick-and-dirty project, so I've added some arbitrary caps to keep the scale manageable
for now while I work out the kinks. If you run into any of these let me know and I'll see what can be done.

- Lists are limited to 50 members
- Only the last 48 hours worth of posts are available through the feed
- Each user can have up to 5 lists
- There's a limit of 1000 total lists across all users

### TODO

- [ ] Make the web UI for adding to lists
- [ ] Filters: allow including/excluding: replies, reskeets, quote-reskeets
- [ ] Smarter history: keep member posts for a reasonable time, say 2 weeks. keep all other posts for the past few hours (so you know it's working when you make a new list)
- [ ] custom descriptions
- [ ] Find a way to encrypt list members
- [ ] Add icon support

Built using the [ATProto Feed Generator starter kit](https://github.com/bluesky-social/feed-generator) [docs](https://atproto.com/lexicons/app-bsky-feed).
