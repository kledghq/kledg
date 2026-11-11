-- Whether the current link of an invitation went back to the inviter (no
-- email delivery) instead of the invitee's mailbox. Holding such a link
-- proves nothing about the address, so accepting it never takes over an
-- existing unconfirmed account (KLEDG-SEC-011). Existing rows default to
-- true: the safe assumption, since their delivery was not recorded.
ALTER TABLE "company_invitations" ADD COLUMN "linkShared" BOOLEAN NOT NULL DEFAULT true;
