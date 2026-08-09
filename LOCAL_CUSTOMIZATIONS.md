This fork contains local/remote Ali usage alignment and quota monitoring.
The source implementation is in packages/server/src, packages/ui/src, and
tools/llm_usage_align.py. The CLI build copies the alignment helper into its
own dist/tools directory so the packaged runtime does not depend on a user-
specific absolute path.
