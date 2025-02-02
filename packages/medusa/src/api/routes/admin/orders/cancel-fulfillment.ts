import {
  FulfillmentService,
  OrderService,
  ProductVariantInventoryService,
} from "../../../../services"

import { IInventoryService } from "@medusajs/types"
import { MedusaError } from "medusa-core-utils"
import { EntityManager } from "typeorm"
import { Fulfillment } from "../../../../models"
import { FindParams } from "../../../../types/common"
import { cleanResponseData } from "../../../../utils/clean-response-data"
import { promiseAll } from "@medusajs/utils"

/**
 * @oas [post] /admin/orders/{id}/fulfillments/{fulfillment_id}/cancel
 * operationId: "PostOrdersOrderFulfillmentsCancel"
 * summary: "Cancel a Fulfilmment"
 * description: "Cancel an order's fulfillment and change its status."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The ID of the Order.
 *   - (path) fulfillment_id=* {string} The ID of the Fulfillment.
 *   - (query) expand {string} Comma-separated relations that should be expanded in the returned order.
 *   - (query) fields {string} Comma-separated fields that should be included in the returned order.
 * x-codegen:
 *   method: cancelFulfillment
 *   params: AdminPostOrdersOrderFulfillementsCancelParams
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.orders.cancelFulfillment(orderId, fulfillmentId)
 *       .then(({ order }) => {
 *         console.log(order.id);
 *       });
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl -X POST '{backend_url}/admin/orders/{id}/fulfillments/{fulfillment_id}/cancel' \
 *       -H 'x-medusa-access-token: {api_token}'
 * security:
 *   - api_token: []
 *   - cookie_auth: []
 *   - jwt_token: []
 * tags:
 *   - Orders
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           $ref: "#/components/schemas/AdminOrdersRes"
 *   "400":
 *     $ref: "#/components/responses/400_error"
 *   "401":
 *     $ref: "#/components/responses/unauthorized"
 *   "404":
 *     $ref: "#/components/responses/not_found_error"
 *   "409":
 *     $ref: "#/components/responses/invalid_state_error"
 *   "422":
 *     $ref: "#/components/responses/invalid_request_error"
 *   "500":
 *     $ref: "#/components/responses/500_error"
 */
export default async (req, res) => {
  const { id, fulfillment_id } = req.params

  const orderService: OrderService = req.scope.resolve("orderService")
  const inventoryService: IInventoryService =
    req.scope.resolve("inventoryService")
  const productVariantInventoryService: ProductVariantInventoryService =
    req.scope.resolve("productVariantInventoryService")

  const fulfillmentService: FulfillmentService =
    req.scope.resolve("fulfillmentService")

  const fulfillment = await fulfillmentService.retrieve(fulfillment_id)

  if (fulfillment.order_id !== id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `no fulfillment was found with the id: ${fulfillment_id} related to order: ${id}`
    )
  }

  const manager: EntityManager = req.scope.resolve("manager")
  await manager.transaction(async (transactionManager) => {
    await orderService
      .withTransaction(transactionManager)
      .cancelFulfillment(fulfillment_id)

    const fulfillment = await fulfillmentService
      .withTransaction(transactionManager)
      .retrieve(fulfillment_id, { relations: ["items", "items.item"] })

    if (fulfillment.location_id && inventoryService) {
      await adjustInventoryForCancelledFulfillment(fulfillment, {
        productVariantInventoryService:
          productVariantInventoryService.withTransaction(transactionManager),
      })
    }
  })

  const order = await orderService.retrieveWithTotals(id, req.retrieveConfig, {
    includes: req.includes,
  })

  res.json({ order: cleanResponseData(order, []) })
}

export const adjustInventoryForCancelledFulfillment = async (
  fulfillment: Fulfillment,
  context: {
    productVariantInventoryService: ProductVariantInventoryService
  }
) => {
  const { productVariantInventoryService } = context
  await promiseAll(
    fulfillment.items.map(async ({ item, quantity }) => {
      if (item.variant_id) {
        await productVariantInventoryService.adjustInventory(
          item.variant_id,
          fulfillment.location_id!,
          quantity
        )
      }
    })
  )
}

export class AdminPostOrdersOrderFulfillementsCancelParams extends FindParams {}
