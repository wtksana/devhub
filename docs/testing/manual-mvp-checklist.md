# DevHub MVP Manual Test Checklist

## Settings

- [ ] settings.json loads on first run.
- [ ] Editing theme/font/layout validates JSON.
- [ ] Password, passphrase, API key are rejected if written directly into settings.json.
- [ ] Copying settings.json and keymap.json restores non-sensitive settings.

## SSH

- [ ] Password login works.
- [ ] Private key login works.
- [ ] Private key passphrase works.
- [ ] sudo prompt works in terminal.
- [ ] Closing a terminal releases the session.
- [ ] 20 terminal tabs remain responsive.

## SFTP

- [ ] Browse writable directory.
- [ ] Upload small file.
- [ ] Download small file.
- [ ] Rename file.
- [ ] Delete file.
- [ ] Permission denied is shown without sudo attempt.
- [ ] 3 concurrent transfer tasks do not freeze terminal input.

## AI

- [ ] BYOK key is stored outside settings.json.
- [ ] AI can explain selected text.
- [ ] AI can generate a command.
- [ ] AI-generated command is not auto-executed.
- [ ] API key does not appear in logs.

## Known MVP Limitations

- No jump host support.
- No SSH agent support.
- No SSH tunnel support.
- No SFTP sudo write.
- No full database or Redis management.
- No AI auto-execution.
