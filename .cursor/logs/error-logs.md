curl --location 'http://localhost
:3001/api/v1/assets/find-route' \
--header 'Content-Type: application/json' \
--data '{"fromAsset":"DOT","toAsset":"1984","amountIn":"7777444444442244"}
'

{
    "status": "success",
    "data": {
        "path": [
            "DOT",
            "1984"
        ],
        "expectedOutput": {
            "raw": "31619409681030452855988",
            "decimal": "31619409681030452"
        },
        "hops": [
            {
                "from": "DOT",
                "to": "1984",
                "amountIn": "7777444444442243",
                "amountOut": "31619409681030452"
            }
        ],
        "dex": "asset_hub"
    }
}