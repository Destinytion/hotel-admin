import NextLink from "next/link";
import type { ComponentProps } from "react";

/*
  The app's link. It loads a page when clicked, not ahead of time.

  Next.js normally fetches every link on screen in the background, and does it
  again after each data refresh. With a refresh every 15 seconds that made
  8 requests where 1 was needed (measured), and a long bills list would have
  made hundreds. On a free host that uses up the monthly allowance for nothing.
*/
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
