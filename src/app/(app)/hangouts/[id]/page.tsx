import { redirect } from 'next/navigation';

export default function HangoutDetailRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/uploads/${params.id}`);
}
