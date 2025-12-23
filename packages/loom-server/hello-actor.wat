;; Simple WASM module that exports an "execute" function
;; Takes a pointer to input JSON string, returns pointer to output JSON string
(module
  ;; Import memory from host
  (import "env" "memory" (memory 1))
  
  ;; Export the execute function
  (func (export "execute") (param i32 i32) (result i32)
    ;; For now, just return a pointer to a static JSON string
    ;; In real implementation, this would parse input and process
    i32.const 100  ;; Return pointer to output data at offset 100
  )
  
  ;; Store output JSON at memory offset 100
  (data (i32.const 100) "{\"greeting\":\"Hello from WASM!\"}")
)
