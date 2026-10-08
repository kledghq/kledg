/**
 * Qonto accounts API methods
 */

import { QontoClientBase } from './client-base'
import type { QontoAccount } from './types'
import { QontoOrganizationSchema } from './schemas'

/**
 * Account-related methods for Qonto API
 */
export class QontoAccounts extends QontoClientBase {
  /**
   * Récupère l'organisation et les comptes bancaires
   */
  async getOrganization(): Promise<{ organization: { bank_accounts: QontoAccount[] } }> {
    return this.request<{ organization: { bank_accounts: QontoAccount[] } }>('/organization', {}, QontoOrganizationSchema)
  }

  /**
   * Récupère les comptes bancaires
   */
  async getAccounts(): Promise<QontoAccount[]> {
    const response = await this.getOrganization()
    return response.organization.bank_accounts
  }
}
