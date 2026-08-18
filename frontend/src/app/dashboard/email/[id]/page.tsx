import { EmailDetail } from '@/components/emails/EmailDetail';

export default async function EmailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmailDetail id={id} />;
}
