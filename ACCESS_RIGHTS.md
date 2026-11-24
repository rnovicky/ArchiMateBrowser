# Access rights

The guide to keys, roles and access rights of the ArchiMate tools is in the
ArchiMate API's folder: [../ArchiMateAPI/ACCESS_RIGHTS.md](../ArchiMateAPI/ACCESS_RIGHTS.md).

For the Browser, in short: each person signs in with their own API key
(*Sign in* in the top bar, 2.13.0), and the API records their changes under
their name. Without a key of their own, the proxy adds `ARCHIXMI_API_KEY`
of the Browser's `.env` (recommended: a reader key), or the API's admin key
when the API's folder is next to it, but only when the Browser listens on
`127.0.0.1`. A `reader` key is enough to browse, and to make offline
copies; editing (created views, *✎ Edit*, the palette, deleting, filing),
the *History* tab and *Update from file* need `editor`; *Import*, *Delete
model* and linking models to files need `admin`. See *The ArchiMate
Browser* in the guide.
